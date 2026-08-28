package xyz.klinik.network

import kotlinx.serialization.Serializable

@Serializable
data class SessionTokens(
    val accessToken: String,
    val refreshToken: String,
    /** Epoch milliseconds. */
    val expiresAtMillis: Long,
) {
    /**
     * Treated as expired slightly early, so a token cannot lapse while the
     * request carrying it is in flight.
     */
    fun isExpired(nowMillis: Long = System.currentTimeMillis(), leewayMillis: Long = 30_000): Boolean =
        nowMillis + leewayMillis >= expiresAtMillis
}

/**
 * Where tokens live between launches.
 *
 * Abstracted so the session logic is testable without Android's EncryptedShared-
 * Preferences, and so a future variant is a new implementation rather than a
 * rewrite.
 */
interface TokenStore {
    suspend fun load(): SessionTokens?
    suspend fun save(tokens: SessionTokens)
    suspend fun clear()
}

/**
 * For tests and previews. Never used in the app: tokens belong in encrypted
 * storage, not in process memory (spec section 8).
 */
class InMemoryTokenStore(initial: SessionTokens? = null) : TokenStore {
    private var stored: SessionTokens? = initial

    override suspend fun load(): SessionTokens? = stored
    override suspend fun save(tokens: SessionTokens) { stored = tokens }
    override suspend fun clear() { stored = null }
}
