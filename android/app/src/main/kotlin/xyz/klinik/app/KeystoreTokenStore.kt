package xyz.klinik.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenStore
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Where the session lives between launches (spec section 8).
 *
 * A refresh token is a live session for a clinical account, so it is encrypted
 * with a key held in the Android keystore — hardware-backed where the device
 * has it. What is written to disk is the ciphertext; the key itself never
 * leaves the keystore and cannot be read out of it, so a backup, an `adb`
 * pull, or another app reading the preferences file gets bytes it cannot use.
 *
 * AndroidX's `EncryptedSharedPreferences` does the same job, but it is
 * deprecated and its replacement is not stable; this is a small enough surface
 * to own outright rather than depend on something being withdrawn.
 *
 * Not `androidx.security` and not a database: two short strings and an expiry.
 */
class KeystoreTokenStore(
    context: Context,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : TokenStore {
    private val preferences: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override suspend fun load(): SessionTokens? = withContext(Dispatchers.IO) {
        val payload = preferences.getString(KEY_PAYLOAD, null) ?: return@withContext null

        try {
            val decoded = Base64.decode(payload, Base64.NO_WRAP)
            if (decoded.size <= IV_BYTES) return@withContext forget()

            val cipher = Cipher.getInstance(TRANSFORMATION).apply {
                init(
                    Cipher.DECRYPT_MODE,
                    existingKey() ?: return@withContext forget(),
                    GCMParameterSpec(TAG_BITS, decoded, 0, IV_BYTES),
                )
            }

            val plaintext = cipher.doFinal(decoded, IV_BYTES, decoded.size - IV_BYTES)
            json.decodeFromString<SessionTokens>(plaintext.decodeToString())
        } catch (error: GeneralSecurityException) {
            // The key is gone or no longer usable: a device restore, a factory
            // reset of the secure hardware, or a lock-screen change that
            // invalidated it. The stored bytes can never be read again, so they
            // are cleared and the user signs in once more — which is the
            // correct outcome, and far better than crashing on every launch.
            forget()
        } catch (error: IllegalArgumentException) {
            // Truncated or corrupt Base64, or a payload this version cannot
            // parse. Same remedy.
            forget()
        }
    }

    override suspend fun save(tokens: SessionTokens) = withContext(Dispatchers.IO) {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            // No IV is supplied: GCM must never reuse one with the same key,
            // and letting the provider generate it is the way to be sure.
            init(Cipher.ENCRYPT_MODE, key())
        }

        val ciphertext = cipher.doFinal(json.encodeToString(tokens).encodeToByteArray())
        val payload = cipher.iv + ciphertext

        preferences.edit()
            .putString(KEY_PAYLOAD, Base64.encodeToString(payload, Base64.NO_WRAP))
            .apply()
    }

    override suspend fun clear() = withContext(Dispatchers.IO) {
        preferences.edit().remove(KEY_PAYLOAD).apply()
        // The key stays. Deleting it would be tidier, but a sign-out racing a
        // background refresh that is mid-encrypt would then fail on a missing
        // key rather than simply writing a value nobody reads.
    }

    private fun forget(): SessionTokens? {
        preferences.edit().remove(KEY_PAYLOAD).apply()
        return null
    }

    private fun existingKey(): SecretKey? = runCatching {
        val store = KeyStore.getInstance(PROVIDER).apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
    }.getOrNull()

    private fun key(): SecretKey = existingKey() ?: generateKey()

    private fun generateKey(): SecretKey =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER).apply {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(KEY_BITS)
                    // Deliberately not requiring the lock screen. Background
                    // synchronisation (spec M15) has to refresh a token while
                    // the phone is in a pocket, and a key that needs the user
                    // present would leave the queue stuck until they next
                    // unlocked — with the records still on the device either
                    // way.
                    .setUserAuthenticationRequired(false)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
        }.generateKey()

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val PREFERENCES = "klinik.session"
        const val KEY_ALIAS = "klinik.session.tokens"
        const val KEY_PAYLOAD = "tokens"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_BITS = 256
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}
