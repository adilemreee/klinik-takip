package xyz.klinik.shell

import xyz.klinik.network.ApiError
import xyz.klinik.network.AuthErrorCode
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.UserRole
import xyz.klinik.network.messageKey
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * That the keys the Kotlin code produces have strings behind them.
 *
 * Deliberately *not* a second key-parity check: `design/scripts/check-strings`
 * already holds the catalogues to the same key set, and two checks that can
 * disagree with each other are worse than one. What that script cannot see is
 * the Kotlin side — which keys the models actually emit, and the rule this app
 * uses to turn one into a resource name. A key with no string behind it shows
 * the raw key to a patient where a sentence should be.
 *
 * Lives in a plain JVM module on purpose: the Android modules need an SDK, and
 * a check that only runs in CI is a check nobody runs before pushing.
 */
class StringCatalogueTest {
    private val strings: Map<String, String> by lazy {
        // Test working directories differ between Gradle and IDEs, so the
        // repository layout is found rather than assumed.
        val resources = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, "core/design/src/main/res") }
            .firstOrNull { it.isDirectory }
            ?: fail("core/design/src/main/res not found from ${File(".").absolutePath}")

        val file = File(resources, "values/strings.xml")
        assertTrue(file.isFile, "${file.path} is missing")

        Regex("""<string name="([a-z_0-9]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(file.readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
            .also { assertTrue(it.size > 100, "only ${it.size} strings parsed; the format changed") }
    }

    private val english: Map<String, String> by lazy {
        val resources = generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, "core/design/src/main/res") }
            .first { it.isDirectory }

        Regex("""<string name="([a-z_0-9]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(resources, "values-en/strings.xml").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    @Test
    fun `every error message key resolves to a string`() {
        // Resolved by name at runtime, so a key with no string behind it shows
        // the key itself. Every branch of messageKey is covered here because
        // the failure is invisible until somebody hits that exact error.
        val errors = listOf(
            ApiError.Offline,
            ApiError.TimedOut,
            ApiError.NotFound(ErrorResponse()),
            ApiError.Forbidden(ErrorResponse()),
            ApiError.Unauthorized(ErrorResponse()),
            ApiError.Server(ErrorResponse()),
            ApiError.Unknown(status = 418),
        ) + AuthErrorCode.entries.map { ApiError.Auth(it, ErrorResponse()) }

        val unresolved = errors
            .map { it.messageKey() }
            .distinct()
            .filterNot { resourceName(it) in strings }
            .sorted()

        assertTrue(unresolved.isEmpty(), "no string for: ${unresolved.joinToString()}")
    }

    @Test
    fun `every role has a display string`() {
        // The role is shown to staff and to anyone the app has no home for; a
        // missing one leaves a blank where the account type should be.
        val missing = UserRole.entries
            .map { it.stringKey }
            .filterNot { it in strings }
            .sorted()

        assertTrue(missing.isEmpty(), "no string for: ${missing.joinToString()}")
    }

    @Test
    fun `the shell's own strings exist`() {
        // Named here rather than only in the Android module, so a rename in the
        // catalogue fails on a laptop instead of at runtime on a phone.
        val required = listOf(
            "app_starting",
            "app_retry",
            "app_identity_failed",
            "app_role_unsupported",
            "app_storage_unavailable",
            "app_staff_title",
            "auth_session_expired",
            "auth_sign_out",
            "patient_not_found",
            "patient_country",
            "patient_city",
        )

        val missing = required.filterNot { it in strings }
        assertTrue(missing.isEmpty(), "no string for: ${missing.joinToString()}")
    }

    @Test
    fun `no long string is identical in both languages`() {
        // A key added in Turkish and pasted unchanged into the English file
        // passes every key-parity check while still showing Turkish to an
        // English reader. Short values that are genuinely the same in both — a
        // unit, a brand name — are why this is a floor rather than absolute.
        val untranslated = strings
            .filterKeys { it in english }
            .filter { (key, value) -> value.length > 24 && english[key] == value }
            .keys
            .sorted()

        assertTrue(
            untranslated.isEmpty(),
            "identical in both languages, so probably untranslated: ${untranslated.joinToString()}",
        )
    }

    @Test
    fun `the key to resource name rule matches the catalogue`() {
        // The rule the app applies at runtime, and the one the generator
        // applies when it writes the XML. If the two ever drift, every dotted
        // key resolves to nothing and the app shows raw keys throughout.
        assertEquals("error_timed_out", resourceName("error.timedOut"))
        assertEquals("error_server", resourceName("error.server"))
        assertEquals("auth_error_invalid_credentials", resourceName("auth.error.invalidCredentials"))
        assertEquals("home_action_upload_document", resourceName("home.action.uploadDocument"))
    }

    /** The same transformation `Context.stringForKey` applies. */
    private fun resourceName(key: String): String = key
        .replace('.', '_')
        .replace(Regex("([a-z0-9])([A-Z])"), "$1_$2")
        .lowercase()
}
