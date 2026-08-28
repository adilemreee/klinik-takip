package xyz.klinik.network

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Performs the token refresh call. Injected so the session logic is testable. */
fun interface TokenRefresher {
    suspend fun refresh(refreshToken: String): SessionTokens
}

enum class SessionState { SIGNED_OUT, SIGNED_IN, EXPIRED }

/**
 * Owns the tokens and, crucially, serialises refreshing them.
 *
 * The backend issues single-use refresh tokens and revokes the entire device
 * session when a consumed one is replayed — that is its defence against a
 * stolen token. It also means a client refreshing twice in parallel signs its
 * own user out: the second call replays a token the first already spent, and
 * the server cannot tell that from theft.
 *
 * The mutex plus the re-check inside it is what prevents that. Callers that
 * queue behind a refresh find a fresh token when they get the lock and return
 * it, rather than each starting one of their own.
 */
class SessionManager(
    private val store: TokenStore,
    private val refresher: TokenRefresher,
) {
    private val refreshMutex = Mutex()

    @Volatile
    private var tokens: SessionTokens? = null

    @Volatile
    var state: SessionState = SessionState.SIGNED_OUT
        private set

    /** Reads whatever was persisted, so a relaunch does not force a sign-in. */
    suspend fun restore() {
        tokens = runCatching { store.load() }.getOrNull()
        state = if (tokens == null) SessionState.SIGNED_OUT else SessionState.SIGNED_IN
    }

    suspend fun signIn(tokens: SessionTokens) {
        this.tokens = tokens
        store.save(tokens)
        state = SessionState.SIGNED_IN
    }

    suspend fun signOut() {
        tokens = null
        store.clear()
        state = SessionState.SIGNED_OUT
    }

    fun currentTokens(): SessionTokens? = tokens

    /** An access token that is valid now, refreshing first if necessary. */
    suspend fun validAccessToken(): String {
        val current = tokens ?: throw ApiError.Unauthorized(ErrorResponse(statusCode = 401))

        if (!current.isExpired()) {
            return current.accessToken
        }

        return refreshLocked().accessToken
    }

    /**
     * Called after a 401 on a request that carried a token we believed valid —
     * the server may have revoked the session, or the clock may have drifted.
     *
     * Takes the token the failed request actually used. If several requests are
     * in flight they all receive 401 with the same stale token, and each
     * refreshing in turn would spend a single-use token for nothing. Comparing
     * against what is stored tells a caller whether someone has already fixed
     * the problem it is reacting to.
     */
    suspend fun refreshAfterUnauthorized(usedAccessToken: String): String =
        refreshLocked(staleAccessToken = usedAccessToken).accessToken

    private suspend fun refreshLocked(staleAccessToken: String? = null): SessionTokens =
        refreshMutex.withLock {
            val latest = tokens ?: throw ApiError.Unauthorized(ErrorResponse(statusCode = 401))

            // Someone refreshed while this caller queued for the lock; the 401
            // it is reacting to is already resolved.
            if (staleAccessToken != null && latest.accessToken != staleAccessToken) {
                return@withLock latest
            }

            // Re-check under the lock. A caller that queued behind a refresh
            // must use that result rather than spending another single-use
            // token on one that is no longer needed.
            if (staleAccessToken == null && !latest.isExpired()) {
                return@withLock latest
            }

            try {
                val refreshed = refresher.refresh(latest.refreshToken)
                store.save(refreshed)
                tokens = refreshed
                state = SessionState.SIGNED_IN
                refreshed
            } catch (error: Throwable) {
                // A rejected refresh means the chain is over: the token was
                // already spent, or the server revoked the family. Keeping it
                // would only produce more failures.
                tokens = null
                runCatching { store.clear() }
                state = SessionState.EXPIRED
                throw error
            }
        }
}
