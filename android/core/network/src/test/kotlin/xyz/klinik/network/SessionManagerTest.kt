package xyz.klinik.network

import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest

/** Counts refreshes so a test can prove how many reached the network. */
private class CountingRefresher(
    private val result: Result<SessionTokens>,
    private val delayMillis: Long = 20,
) : TokenRefresher {
    val callCount = AtomicInteger(0)

    override suspend fun refresh(refreshToken: String): SessionTokens {
        callCount.incrementAndGet()
        delay(delayMillis)
        return result.getOrThrow()
    }
}

class SessionManagerTest {
    private fun tokens(expiresInMillis: Long, label: String = "a"): SessionTokens =
        SessionTokens(
            accessToken = "access-$label",
            refreshToken = "refresh-$label",
            expiresAtMillis = System.currentTimeMillis() + expiresInMillis,
        )

    @Test
    fun `returns the current token while it is still valid`() = runTest {
        val refresher = CountingRefresher(Result.success(tokens(900_000, "new")))
        val manager = SessionManager(InMemoryTokenStore(), refresher)
        val current = tokens(900_000, "current")
        manager.signIn(current)

        assertEquals(current.accessToken, manager.validAccessToken())
        assertEquals(0, refresher.callCount.get())
    }

    @Test
    fun `refreshes a token that is about to expire`() = runTest {
        val refreshed = tokens(900_000, "refreshed")
        val refresher = CountingRefresher(Result.success(refreshed))
        val manager = SessionManager(InMemoryTokenStore(), refresher)
        manager.signIn(tokens(10_000, "stale"))

        assertEquals(refreshed.accessToken, manager.validAccessToken())
    }

    /**
     * The property this class exists for.
     *
     * The backend revokes the whole device session when a consumed refresh
     * token is replayed, because it cannot tell replay from theft. Two parallel
     * refreshes would therefore sign the user out — from the client's own
     * behaviour, with nothing wrong on the server.
     */
    @Test
    fun `twenty concurrent callers produce exactly one refresh`() = runTest {
        val refresher = CountingRefresher(Result.success(tokens(900_000, "refreshed")))
        val manager = SessionManager(InMemoryTokenStore(), refresher)
        manager.signIn(tokens(-1_000, "expired"))

        val results = (1..20).map { async { manager.validAccessToken() } }.awaitAll()

        assertEquals(1, refresher.callCount.get())
        assertEquals(1, results.toSet().size)
    }

    /**
     * Requests already in flight all come back 401 carrying the same stale
     * token. Each refreshing in turn would spend a single-use token for
     * nothing, so only the first does.
     */
    @Test
    fun `concurrent reactions to the same 401 produce one refresh`() = runTest {
        val refresher = CountingRefresher(Result.success(tokens(900_000, "refreshed")))
        val manager = SessionManager(InMemoryTokenStore(), refresher)
        val stale = tokens(900_000, "stale")
        manager.signIn(stale)

        val results = (1..10)
            .map { async { manager.refreshAfterUnauthorized(stale.accessToken) } }
            .awaitAll()

        assertEquals(1, refresher.callCount.get())
        assertEquals(1, results.toSet().size)
    }

    @Test
    fun `a failed refresh ends the session`() = runTest {
        val store = InMemoryTokenStore()
        val refresher = CountingRefresher(
            Result.failure(ApiError.Unauthorized(ErrorResponse(statusCode = 401))),
        )
        val manager = SessionManager(store, refresher)
        manager.signIn(tokens(-1_000))

        assertFailsWith<ApiError.Unauthorized> { manager.validAccessToken() }
        assertEquals(SessionState.EXPIRED, manager.state)
        assertNull(store.load())
    }

    @Test
    fun `a failing refresh is not retried once per caller`() = runTest {
        val refresher = CountingRefresher(
            Result.failure(ApiError.Unauthorized(ErrorResponse(statusCode = 401))),
        )
        val manager = SessionManager(InMemoryTokenStore(), refresher)
        manager.signIn(tokens(-1_000))

        val failures = (1..10).map {
            async { runCatching { manager.validAccessToken() }.isFailure }
        }.awaitAll()

        assertEquals(10, failures.count { it })
        assertEquals(1, refresher.callCount.get())
    }

    @Test
    fun `signing out clears persisted tokens`() = runTest {
        val store = InMemoryTokenStore()
        val manager = SessionManager(store, CountingRefresher(Result.success(tokens(900_000))))
        manager.signIn(tokens(900_000))

        manager.signOut()

        assertNull(store.load())
        assertEquals(SessionState.SIGNED_OUT, manager.state)
    }

    @Test
    fun `restores a persisted session on launch`() = runTest {
        val stored = tokens(900_000, "stored")
        val manager = SessionManager(
            InMemoryTokenStore(stored),
            CountingRefresher(Result.success(stored)),
        )

        manager.restore()

        assertEquals(SessionState.SIGNED_IN, manager.state)
        assertEquals(stored.accessToken, manager.currentTokens()?.accessToken)
    }

    @Test
    fun `refuses to produce a token when signed out`() = runTest {
        val manager = SessionManager(
            InMemoryTokenStore(),
            CountingRefresher(Result.success(tokens(900_000))),
        )

        val error = assertFailsWith<ApiError.Unauthorized> { manager.validAccessToken() }
        assertTrue(error.requiresReauthentication)
    }
}
