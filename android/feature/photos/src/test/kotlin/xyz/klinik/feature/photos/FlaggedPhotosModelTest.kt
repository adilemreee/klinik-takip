package xyz.klinik.feature.photos

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher

private object FlaggedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("Reading the flagged list must not refresh a session")
}

private class FlaggedTransport(private val bodies: Map<String, Pair<Int, String>>) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/")
        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")

        return HttpResponse(status, body)
    }
}

private fun photo(
    id: String,
    takenAt: String,
    suggested: Boolean? = true,
    findings: String = """["redness"]""",
) = """
    {"id":"$id","patientId":"pat-1","patientName":"Ayşe Yılmaz","mrn":"2026-K7RMPX",
     "category":"WOUND","bodyArea":"karın","phaseLabel":null,
     "mime":"image/jpeg","size":1024,"takenAt":"$takenAt","exifStripped":true,
     "isFaceBlurred":false,"consentId":null,"note":null,
     "aiReviewSuggested":${suggested?.toString() ?: "null"},
     "aiFindings":$findings,"aiAssessedAt":"2026-09-11T08:00:00.000Z"}
""".trimIndent()

/** What `POST /photos/{id}/assess` returns: the photo alone, with no patient on it. */
private fun assessment(suggested: Boolean, findings: String) = """
    {"photo":{"id":"p1","category":"WOUND","bodyArea":"karın","phaseLabel":null,
      "mime":"image/jpeg","size":1024,"takenAt":"2026-09-08T08:00:00.000Z",
      "exifStripped":true,"isFaceBlurred":false,"consentId":null,"note":null,
      "aiReviewSuggested":$suggested,"aiFindings":$findings,
      "aiAssessedAt":"2026-09-12T08:00:00.000Z"},
     "findings":$findings,"reviewSuggested":$suggested,"model":"claude","skippedReason":null}
""".trimIndent()

/**
 * The photographs an assessment thought somebody should look at (spec M5).
 *
 * A queue of work: oldest first, each row naming whose wound it is, and a
 * re-assessment answering about the photograph rather than making it vanish.
 */
class FlaggedPhotosModelTest {
    private suspend fun model(transport: FlaggedTransport): FlaggedPhotosModel {
        val session = SessionManager(InMemoryTokenStore(), FlaggedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))

        return FlaggedPhotosModel(
            PhotosApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
        )
    }

    private fun listOf(vararg rows: String) = FlaggedTransport(
        mapOf("GET photos/flagged" to (200 to "[${rows.joinToString(",")}]")),
    )

    /** The photograph waiting since Tuesday is the one somebody should see. */
    @Test
    fun `the oldest photograph is first`() = runTest {
        val subject = model(
            listOf(
                photo("new", "2026-09-11T08:00:00.000Z"),
                photo("old", "2026-09-08T08:00:00.000Z"),
            ),
        )

        subject.load()

        assertEquals(
            kotlin.collections.listOf("old", "new"),
            subject.state.value.photos.map { it.id },
        )
    }

    /** Nothing flagged is the good state, and is said rather than drawn blank. */
    @Test
    fun `an empty queue is its own state`() = runTest {
        val subject = model(FlaggedTransport(mapOf("GET photos/flagged" to (200 to "[]"))))

        subject.load()

        assertEquals(FlaggedPhase.Empty, subject.state.value.phase)
    }

    /**
     * The row says whose photograph it is.
     *
     * A clinic-wide worklist that names only the wound is something to read
     * rather than something to act on: the clinician cannot open the file.
     */
    @Test
    fun `each row names the patient it belongs to`() = runTest {
        val subject = model(listOf(photo("p1", "2026-09-08T08:00:00.000Z")))

        subject.load()

        val row = subject.state.value.photos.single()

        assertEquals("pat-1", row.patientId)
        assertEquals("Ayşe Yılmaz", row.patientName)
        assertEquals("2026-K7RMPX", row.mrn)
    }

    /**
     * A re-assessment that found nothing is an answer about that photograph.
     *
     * Removing the row would leave a clinician unsure which one it had been.
     */
    @Test
    fun `a re-assessment replaces the row rather than removing it`() = runTest {
        val subject = model(
            FlaggedTransport(
                mapOf(
                    "GET photos/flagged" to (
                        200 to "[${photo("p1", "2026-09-08T08:00:00.000Z")}]"
                        ),
                    "POST photos/p1/assess" to (200 to assessment(suggested = false, findings = "[]")),
                ),
            ),
        )

        subject.load()

        assertTrue(subject.reassess(subject.state.value.photos.single()))

        val row = subject.state.value.photos.single()

        assertEquals("p1", row.id)
        assertTrue(row.isAssessedClean)
        assertFalse(row.needsReview)
    }

    /**
     * And the patient stays on it.
     *
     * The assessment answers about the photograph and says nothing about whose
     * it is; a row that lost the name would stay on screen and stop being
     * usable.
     */
    @Test
    fun `a re-assessment keeps the patient on the row`() = runTest {
        val subject = model(
            FlaggedTransport(
                mapOf(
                    "GET photos/flagged" to (
                        200 to "[${photo("p1", "2026-09-08T08:00:00.000Z")}]"
                        ),
                    "POST photos/p1/assess" to (200 to assessment(suggested = false, findings = "[]")),
                ),
            ),
        )

        subject.load()
        subject.reassess(subject.state.value.photos.single())

        assertEquals("Ayşe Yılmaz", subject.state.value.photos.single().patientName)
    }

    /** Nobody looked and nothing was found are different answers. */
    @Test
    fun `an unassessed photograph is not a clean one`() = runTest {
        val subject = model(
            listOf(photo("p1", "2026-09-08T08:00:00.000Z", suggested = null, findings = "[]")),
        )

        subject.load()

        val row = subject.state.value.photos.single()

        assertFalse(row.isAssessedClean)
        assertFalse(row.needsReview)
    }

    /** The findings keep the catalogue's spelling, hyphens and all. */
    @Test
    fun `findings become catalogue keys`() = runTest {
        val subject = model(
            listOf(
                photo(
                    "p1",
                    "2026-09-08T08:00:00.000Z",
                    findings = """["redness","wound-open"]""",
                ),
            ),
        )

        subject.load()

        assertEquals(
            kotlin.collections.listOf("photo.finding.redness", "photo.finding.wound-open"),
            subject.state.value.photos.single().findingKeys(),
        )
    }

    @Test
    fun `a forbidden account is told so rather than shown an error`() = runTest {
        val subject = model(
            FlaggedTransport(
                mapOf("GET photos/flagged" to (403 to """{"message":"forbidden"}""")),
            ),
        )

        subject.load()

        assertEquals(FlaggedPhase.NotPermitted, subject.state.value.phase)
    }

    @Test
    fun `a failed re-assessment leaves the row alone`() = runTest {
        val subject = model(
            FlaggedTransport(
                mapOf(
                    "GET photos/flagged" to (
                        200 to "[${photo("p1", "2026-09-08T08:00:00.000Z")}]"
                        ),
                    "POST photos/p1/assess" to (500 to "{}"),
                ),
            ),
        )

        subject.load()

        assertFalse(subject.reassess(subject.state.value.photos.single()))
        assertTrue(subject.state.value.photos.single().needsReview)
        assertNotNull(subject.state.value.error)
    }
}
