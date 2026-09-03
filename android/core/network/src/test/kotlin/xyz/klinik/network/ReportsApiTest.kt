package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

private val patientReport = """
    {"id":"r1","source":"lab",
     "contentMd":"Kan değerlerinizden biri beklenenin altında.",
     "generatedAt":"2026-03-01T08:00:00.000Z",
     "releasedAt":"2026-03-01T09:00:00.000Z",
     "disclaimer":"Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez."}
""".trimIndent()

private val staffView = """
    {"report":{"id":"r1","patientId":"p1","source":"lab",
      "contentMd":"## Bulgular\nHemoglobin kritik düşük.",
      "patientFacingMd":"Kan değerlerinizden biri beklenenin altında.",
      "riskLevel":"CRITICAL","model":"test-model-2026","modelVersion":"test-model-2026",
      "generatedAt":"2026-03-01T08:00:00.000Z","reviewedById":null,
      "reviewedAt":null,"releasedToPatientAt":null},
     "disclaimer":"Bu içerik yapay zeka tarafından üretilmiştir, tıbbi tanı yerine geçmez.",
     "visibleToPatient":false}
""".trimIndent()

/**
 * The report shapes, and the one property that matters on the client.
 *
 * The server decides what a patient may see; the client's job is to render it
 * with the warning attached and never to reconstruct the clinical half.
 */
class ReportsApiTest {
    /**
     * The patient's document has no field for the clinical text and none for
     * the risk label, so a client cannot show either by accident.
     */
    @Test
    fun `the patient document carries no clinical text and no risk label`() {
        val report = json.decodeFromString<PatientReport>(patientReport)

        assertEquals("Kan değerlerinizden biri beklenenin altında.", report.contentMd)
        assertTrue(report.disclaimer.isNotEmpty())

        val fields = PatientReport::class.java.declaredFields.map { it.name }
        assertFalse(fields.contains("riskLevel"))
        assertFalse(fields.contains("patientFacingMd"))
    }

    @Test
    fun `the warning comes from the server rather than the client`() {
        // Not a client string: an SMS or an export has no client to localise it,
        // and a warning the client forgets to add is a warning that is missing.
        val report = json.decodeFromString<PatientReport>(patientReport)

        assertTrue(report.disclaimer.contains("tanı yerine geçmez"))
    }

    @Test
    fun `the staff view keeps both renderings apart`() {
        val view = json.decodeFromString<ReportView>(staffView)

        assertTrue(view.report.contentMd.contains("kritik düşük"))
        assertEquals("Kan değerlerinizden biri beklenenin altında.", view.report.patientFacingMd)
        assertFalse(view.visibleToPatient)
        assertFalse(view.isReviewed)
        assertNull(view.report.releasedToPatientAt)
    }

    @Test
    fun `marks the reports a clinician should open first`() {
        val view = json.decodeFromString<ReportView>(staffView)

        assertEquals(RiskLevel.CRITICAL, view.report.riskLevel)
        assertTrue(view.report.riskLevel!!.needsAttention)
        assertFalse(RiskLevel.LOW.needsAttention)
        assertFalse(RiskLevel.MEDIUM.needsAttention)
    }

    @Test
    fun `has a string key for every risk level`() {
        for (risk in RiskLevel.entries) {
            assertTrue(risk.stringKey.startsWith("report_risk_"))
        }
    }
}
