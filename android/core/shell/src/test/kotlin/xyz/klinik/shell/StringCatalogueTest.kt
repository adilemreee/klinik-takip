package xyz.klinik.shell

import xyz.klinik.network.AgeingBucket
import xyz.klinik.network.ApiError
import xyz.klinik.network.AppointmentStatus
import xyz.klinik.network.AppointmentType
import xyz.klinik.network.AuthErrorCode
import xyz.klinik.network.BmiCategory
import xyz.klinik.network.ClinicalPhoto
import xyz.klinik.network.ComplicationStatus
import xyz.klinik.network.ConsentType
import xyz.klinik.network.Currency
import xyz.klinik.network.DocumentType
import xyz.klinik.network.DoseStatus
import xyz.klinik.network.EmergencyStatus
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.ExportFormat
import xyz.klinik.network.ExportOmission
import xyz.klinik.network.ExportStatus
import xyz.klinik.network.HandoverReason
import xyz.klinik.network.InteractionSeverity
import xyz.klinik.network.LabFlag
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.MeasurementType
import xyz.klinik.network.MessageStatus
import xyz.klinik.network.Milestone
import xyz.klinik.network.MilestoneStatus
import xyz.klinik.network.MyMedications
import xyz.klinik.network.NotificationChannel
import xyz.klinik.network.NotificationDeliveryStatus
import xyz.klinik.network.NotificationKind
import xyz.klinik.network.PaymentMethod
import xyz.klinik.network.PaymentStatus
import xyz.klinik.network.PhotoCategory
import xyz.klinik.network.ProcessingStatus
import xyz.klinik.network.RiskKind
import xyz.klinik.network.RiskLevel
import xyz.klinik.network.SurveyFindingKind
import xyz.klinik.network.Totals
import xyz.klinik.network.TriageLevel
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
    private val designModule: File by lazy {
        // Test working directories differ between Gradle and IDEs, so the
        // repository layout is found rather than assumed.
        generateSequence(File(".").absoluteFile) { it.parentFile }
            .map { File(it, "core/design/src/main") }
            .firstOrNull { it.isDirectory }
            ?: fail("core/design/src/main not found from ${File(".").absolutePath}")
    }

    private val strings: Map<String, String> by lazy {
        val file = File(designModule, "res/values/strings.xml")
        assertTrue(file.isFile, "${file.path} is missing")

        Regex("""<string name="([a-z_0-9]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(file.readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
            .also { assertTrue(it.size > 100, "only ${it.size} strings parsed; the format changed") }
    }

    private val english: Map<String, String> by lazy {
        Regex("""<string name="([a-z_0-9]+)">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(File(designModule, "res/values-en/strings.xml").readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    /**
     * The generated dotted-key lookup the app actually reads at runtime.
     *
     * Read as text because it lives in an Android module this one cannot depend
     * on — the point of being a plain JVM test.
     */
    private val lookup: Map<String, String> by lazy {
        val file = File(designModule, "kotlin/xyz/klinik/design/Strings.generated.kt")
        assertTrue(file.isFile, "${file.path} is missing; run design/scripts/generate-strings.mjs")

        Regex("""^\s*"([^"]+)" to R\.string\.([a-z_0-9]+),$""", RegexOption.MULTILINE)
            .findAll(file.readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
            .also { assertTrue(it.size > 100, "only ${it.size} keys parsed; the format changed") }
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
            .filterNot { it in lookup }
            .sorted()

        assertTrue(unresolved.isEmpty(), "no string for: ${unresolved.joinToString()}")
    }

    @Test
    fun `every enum the screens look up by name has a string`() {
        // These are resolved at runtime from the enum's own name, so a value
        // added later with no string shows the raw key on a clinical screen.
        // Grouped by prefix and checked for the exact count the enum has.
        val expected = mapOf(
            "followUp.status." to 5,
            "appointment.type." to 4,
            "appointment.status." to 5,
            "notification.channel." to 5,
            "notification.status." to 5,
            "notification.type." to 7,
            "medication.status." to 5,
        )

        for ((prefix, count) in expected) {
            val found = lookup.keys.count { it.startsWith(prefix) }

            assertEquals(count, found, "$prefix has $found strings, expected $count")
        }
    }

    @Test
    fun `every stringKey a model emits resolves to a string`() {
        // `stringKey` is the one place the models name a string themselves, and
        // nothing about the property's type says which spelling is right: the
        // lookup is keyed by the shared catalogue (`role.DOCTOR`), not by the
        // Android resource name (`role_doctor`). Twenty of these carried the
        // resource spelling, which no lookup matches; they were only invisible
        // because no screen had reached for them yet. Every one is listed here
        // so a new key is checked on a laptop rather than by a reader seeing
        // `emergency.status.TRIGGERED` where a sentence belongs.
        val totals = Totals(currency = Currency.TRY, converted = "0")

        val emitted = listOf(
            UserRole.entries,
            AppointmentType.entries,
            AppointmentStatus.entries,
            HandoverReason.entries,
            RiskKind.entries,
            ComplicationStatus.entries,
            ConsentType.entries,
            DocumentType.entries,
            ProcessingStatus.entries,
            EmergencyStatus.entries,
            ExportStatus.entries,
            ExportFormat.entries,
            PaymentStatus.entries,
            PaymentMethod.entries,
            MilestoneStatus.entries,
            LabFlag.entries,
            MeasurementType.entries,
            MeasurementSource.entries,
            BmiCategory.entries,
            DoseStatus.entries,
            InteractionSeverity.entries,
            MessageStatus.entries,
            TriageLevel.entries,
            NotificationChannel.entries,
            NotificationDeliveryStatus.entries,
            NotificationKind.entries,
            PhotoCategory.entries,
            RiskLevel.entries,
            SurveyFindingKind.entries,
        ).flatten().map { entry ->
            // `stringKey` is declared per enum rather than on a shared
            // interface, so it is read reflectively instead of widening the
            // production types for a test's convenience.
            entry.javaClass.getMethod("getStringKey").invoke(entry) as String
        }

        // The ones that key off a server string instead of an enum. The values
        // are the ones the server sends today; a new one needs a string adding
        // here and to the catalogue together. These cannot be read out of the
        // source the way the literal check below does it — the key is built by
        // interpolation, so there is no complete literal to find — which is
        // why they are constructed here instead.
        val fromServer =
            milestoneLabels.map { Milestone(id = "m", label = it, dueAt = "2026-01-01").stringKey } +
                ageingBuckets.map { AgeingBucket(bucket = it, totals = totals).stringKey } +
                omissionReasons.map { ExportOmission(section = "photos", reason = it).stringKey } +
                MyMedications(badges = medicationBadges).badgeKeys() +
                ClinicalPhoto(
                    id = "p",
                    category = PhotoCategory.WOUND,
                    mime = "image/jpeg",
                    size = 1,
                    takenAt = "2026-01-01T00:00:00.000Z",
                    aiFindings = photoFindings,
                ).findingKeys()

        val missing = (emitted + fromServer).distinct().filterNot { it in lookup }.sorted()

        assertTrue(missing.isEmpty(), "no string for: ${missing.joinToString()}")
    }

    /**
     * And the same for every *other* property that names a string.
     *
     * `stringKey` is not the only spelling — there is `explanationKey`,
     * `revenueNoticeKey`, `truncationKey`, and whatever the next one is
     * called. Two of those three carried the Android resource name, which no
     * lookup matches, and the test above could not see them because it was
     * written around one property name. Read from source rather than
     * reflected, because the interesting ones are string literals inside a
     * getter that a running test never evaluates unless it happens to hold an
     * instance in the right state.
     */
    @Test
    fun `every literal key in the models resolves to a string`() {
        // The models and the feature modules both declare keys now, so both
        // are read. Not the Compose modules: those resolve strings through a
        // `…Strings` record the app fills in, which the compiler checks.
        val repository = designModule.parentFile.parentFile.parentFile.parentFile

        val sources = listOf(File(repository, "core/network/src/main"), File(repository, "feature"))
            .flatMap { root -> root.walkTopDown().filter { it.extension == "kt" } }
            .filterNot { it.path.contains("/src/test/") }
            .toList()

        assertTrue(sources.size > 20, "only ${sources.size} model files found")

        /*
         * A literal inside anything named `…Key` or `…Keys`, which is this
         * codebase's one convention for "the catalogue decides these words".
         * Functions as well as properties: `badgeKeys()` and `findingKeys()`
         * are declared as functions and both carried the resource spelling.
         *
         * The body runs to the next declaration rather than the end of the
         * line, because `caveatKeys` builds a list over several lines and a
         * line-bounded match read none of it — which is how two of these
         * survived the first pass.
         */
        val pattern = Regex(
            """(?:val|fun) \w*Keys?\s*[(:].*?=(.*?)(?=\n\s*(?:val |fun |\}\n))""",
            RegexOption.DOT_MATCHES_ALL,
        )

        val missing = sources.flatMap { file ->
            pattern.findAll(file.readText()).flatMap { match ->
                Regex(""""([a-zA-Z][\w.\-]*)"""").findAll(match.groupValues[1])
                    .map { it.groupValues[1] }
            }
        }
            // Interpolated keys are covered by the test above, which builds
            // real values; only the complete literals are checkable here. A
            // literal ending in a separator is a prefix that a name is
            // concatenated onto, so it is one of those rather than a key.
            .filter { (it.contains('.') || it.contains('_')) && !it.endsWith('.') }
            .distinct()
            .filterNot { it in lookup }
            .sorted()

        assertTrue(missing.isEmpty(), "no string for: ${missing.joinToString()}")
    }

    /** The follow-up phases, shared with the photo gallery. */
    private val milestoneLabels = listOf("D1", "D3", "W1", "W2", "M1", "M2", "M3", "M6", "Y1")

    private val ageingBuckets = listOf("current", "d30", "d60", "over90")

    private val omissionReasons =
        listOf("ai-unreviewed", "lab-unverified", "photo-no-consent", "photo-not-requested")

    /** The encouragements a medication course earns, when the tone rule allows. */
    private val medicationBadges =
        listOf("first-dose", "three-days", "one-week", "four-weeks")

    /** What the photo assessment can point at. */
    private val photoFindings = listOf("redness", "swelling", "discharge", "wound-open")

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
    fun `the generated lookup maps dotted keys onto the resources`() {
        // The dotted key is what the shared models emit; the resource name is
        // what Android has. The generator bridges them, and if it ever stopped
        // camel-casing correctly every affected key would point at a resource
        // that does not exist — which is a compile error in the app, but this
        // says which rule broke.
        assertEquals("error_timed_out", lookup["error.timedOut"])
        assertEquals("error_server", lookup["error.server"])
        assertEquals("auth_error_invalid_credentials", lookup["auth.error.invalidCredentials"])
        assertEquals("home_action_upload_document", lookup["home.action.uploadDocument"])
    }

    @Test
    fun `the generated lookup covers the whole catalogue`() {
        // Anything in the XML and not in the map is a string the app cannot
        // reach by key, and anything in the map and not in the XML would not
        // compile.
        val missing = strings.keys - lookup.values.toSet()

        assertTrue(missing.isEmpty(), "not reachable by key: ${missing.sorted().joinToString()}")
    }
}
