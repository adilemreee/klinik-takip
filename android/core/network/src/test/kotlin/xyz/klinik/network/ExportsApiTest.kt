package xyz.klinik.network

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json

private val json = Json { ignoreUnknownKeys = true }

/**
 * Patient summary exports (spec M12, T6.5).
 *
 * Two distinctions this screen must not blur: a file that expired on schedule
 * is not one that failed, and a report with omissions is not a complete one.
 */
class ExportsApiTest {
    private val now = "2026-03-05T09:00:00.000Z"

    @Test
    fun `knows when to keep asking`() {
        val queued = json.decodeFromString<ExportRequest>(
            """{"id":"e1","kind":"PATIENT_SUMMARY","status":"QUEUED","patientId":"p1"}""",
        )

        assertTrue(queued.status.isPending)
        assertFalse(queued.isReady(now))
        assertNull(queued.contents)
    }

    @Test
    fun `a ready export carries its manifest`() {
        val ready = json.decodeFromString<ExportRequest>(
            """
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"DONE","patientId":"p1","size":21612,
             "contents":{"surgeries":1,"measurementSeries":2,"labs":4,"medications":3,
                         "photos":0,"aiReports":1,"omissions":[]},
             "expiresAt":"2099-03-09T09:00:00.000Z"}
            """.trimIndent(),
        )

        assertTrue(ready.isReady(now))
        assertTrue(ready.contents!!.isComplete)
        assertEquals(21612, ready.size)
    }

    /** A file cleaned up on schedule is a success, not a fault to go looking for. */
    @Test
    fun `expired is not failed`() {
        val expired = json.decodeFromString<ExportRequest>(
            """
            {"id":"e1","kind":"PATIENT_SUMMARY","status":"DONE","patientId":"p1","size":100,
             "contents":{"omissions":[]},"expiresAt":"2020-03-09T09:00:00.000Z"}
            """.trimIndent(),
        )

        assertTrue(expired.hasExpired(now))
        assertFalse(expired.isReady(now))
        assertEquals(ExportStatus.DONE, expired.status)
    }

    @Test
    fun `a failure carries its reason`() {
        val failed = json.decodeFromString<ExportRequest>(
            """{"id":"e1","kind":"PATIENT_SUMMARY","status":"FAILED","error":"Patient not found"}""",
        )

        assertEquals("Patient not found", failed.error)
        assertFalse(failed.status.isPending)
        assertFalse(failed.hasExpired(now))
    }

    @Test
    fun `omissions have a resource key rather than a raw code`() {
        val contents = json.decodeFromString<ExportContents>(
            """
            {"labs":2,"omissions":[{"section":"labs","reason":"lab-unverified","count":3},
                                   {"section":"photos","reason":"photo-no-consent","count":2}]}
            """.trimIndent(),
        )

        assertFalse(contents.isComplete)
        assertEquals("export_omission_lab_unverified", contents.omissions[0].stringKey)
        assertEquals("export_omission_photo_no_consent", contents.omissions[1].stringKey)
        assertEquals(3, contents.omissions[0].count)
    }

    @Test
    fun `a download link knows when it has lapsed`() {
        val fresh = json.decodeFromString<ExportDownload>(
            """{"url":"https://x/y?X-Amz-Signature=a","expiresAt":"2099-01-01T00:00:00.000Z","filename":"a.pdf"}""",
        )
        val stale = json.decodeFromString<ExportDownload>(
            """{"url":"https://x/y?X-Amz-Signature=a","expiresAt":"2020-01-01T00:00:00.000Z","filename":"a.pdf"}""",
        )

        assertTrue(fresh.isStillValid(now))
        assertFalse(stale.isStillValid(now))
        assertTrue(fresh.filename.endsWith(".pdf"))
    }

    @Test
    fun `has a string key for every status`() {
        for (status in ExportStatus.entries) {
            assertTrue(status.stringKey.startsWith("export_status_"))
        }
    }
}
