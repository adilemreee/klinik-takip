package xyz.klinik.feature.photos

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.PhotoCategory
import xyz.klinik.network.PhotosApi
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

private class PathTransport(
    private val bodies: Map<String, Pair<Int, String>>,
) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val (status, body) = bodies["${request.method} $path"] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The gallery must not refresh")
}

class PhotoGalleryModelTest {
    private fun photo(
        id: String,
        area: String = "burun",
        takenAt: String = "2026-01-01T08:00:00.000Z",
        consent: String = "null",
    ) = """
        {"id":"$id","category":"BEFORE","bodyArea":"$area","phaseLabel":"pre-op",
         "mime":"image/jpeg","size":1024,"takenAt":"$takenAt","exifStripped":true,
         "isFaceBlurred":false,"consentId":$consent,"note":null}
    """.trimIndent()

    private fun group(area: String, photos: List<String>) =
        """{"bodyArea":"$area","photos":[${photos.joinToString(",")}]}"""

    private suspend fun model(transport: HttpTransport): PhotoGalleryModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return PhotoGalleryModel(
            PhotosApi(ApiClient(ApiConfiguration("https://api.test"), transport, session)),
            "p1",
        )
    }

    @Test
    fun `loads the gallery grouped by body area`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf(
                    "GET patients/p1/photos" to (
                        200 to
                            "[${group("abdomen", listOf(photo("a1", area = "abdomen")))},${group("burun", listOf(photo("b1")))}]"
                        ),
                ),
            ),
        )

        gallery.load()

        val state = gallery.state.value

        assertEquals(GalleryPhase.Loaded, state.phase)
        assertEquals(listOf("abdomen", "burun"), state.groups.map { it.bodyArea })
        assertEquals("abdomen", state.selectedGroup?.bodyArea)
    }

    /** No photos yet is not a failure and must not be shown as one. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val gallery = model(PathTransport(mapOf("GET patients/p1/photos" to (200 to "[]"))))

        gallery.load()

        assertEquals(GalleryPhase.Empty, gallery.state.value.phase)
    }

    /**
     * The comparison opens on the earliest and the latest of the selected area
     * — the two shots between which something changed.
     */
    @Test
    fun `comparison pairs the earliest with the latest`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf(
                    "GET patients/p1/photos" to (
                        200 to
                            "[${group(
                                "burun",
                                listOf(
                                    photo("b1", takenAt = "2026-01-01T08:00:00.000Z"),
                                    photo("b2", takenAt = "2026-02-01T08:00:00.000Z"),
                                    photo("b3", takenAt = "2026-03-01T08:00:00.000Z"),
                                ),
                            )}]"
                        ),
                ),
            ),
        )

        gallery.load()

        assertEquals("b1", gallery.state.value.comparison?.before?.id)
        assertEquals("b3", gallery.state.value.comparison?.after?.id)
    }

    /**
     * A slider over one image does nothing, and offering it suggests there is a
     * change to see.
     */
    @Test
    fun `offers no comparison for a single photo`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf("GET patients/p1/photos" to (200 to "[${group("burun", listOf(photo("b1")))}]")),
            ),
        )

        gallery.load()

        assertNull(gallery.state.value.comparison)
    }

    @Test
    fun `switches body area`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf(
                    "GET patients/p1/photos" to (
                        200 to
                            "[${group("abdomen", listOf(photo("a1", area = "abdomen")))},${group("burun", listOf(photo("b1")))}]"
                        ),
                ),
            ),
        )

        gallery.load()
        gallery.select("burun")

        assertEquals("burun", gallery.state.value.selectedGroup?.bodyArea)
    }

    /**
     * Whether a photo may be used outside the clinic is a fact about the image,
     * and the screen shows it on the image.
     */
    @Test
    fun `carries whether usage consent was given`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf(
                    "GET patients/p1/photos" to (
                        200 to
                            "[${group("burun", listOf(photo("b1", consent = "\"c1\""), photo("b2")))}]"
                        ),
                ),
            ),
        )

        gallery.load()

        val photos = gallery.state.value.selectedGroup?.photos

        assertTrue(photos!![0].hasUsageConsent)
        assertFalse(photos[1].hasUsageConsent)
    }

    /**
     * The overlay endpoint answers with an empty object when there is nothing
     * to line up against, which must read as "none" rather than as a failure.
     */
    @Test
    fun `reports no overlay reference for a first photo`() = runTest {
        val gallery = model(
            PathTransport(mapOf("GET patients/p1/photos/overlay" to (200 to "{}"))),
        )

        assertNull(gallery.overlayReference("kol"))
    }

    @Test
    fun `returns the overlay reference when there is one`() = runTest {
        val gallery = model(
            PathTransport(mapOf("GET patients/p1/photos/overlay" to (200 to photo("b9")))),
        )

        assertEquals("b9", gallery.overlayReference("burun")?.id)
    }

    /**
     * The server refuses a format whose location data it cannot strip and says
     * so; replacing that leaves the person guessing why a photo was rejected.
     */
    @Test
    fun `keeps the server message when an upload is refused`() = runTest {
        val gallery = model(
            PathTransport(
                mapOf(
                    "POST patients/p1/photos" to (
                        400 to
                            """{"statusCode":400,"message":"Photos must be JPEG or PNG; image/heic cannot have its location data removed"}"""
                        ),
                ),
            ),
        )

        val uploaded = gallery.upload("/tmp/p.heic", "p.heic", PhotoCategory.WOUND, "abdomen")

        assertFalse(uploaded)
        assertEquals(
            UiText.Literal(
                "Photos must be JPEG or PNG; image/heic cannot have its location data removed",
            ),
            gallery.state.value.error,
        )
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val gallery = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        gallery.load()

        assertEquals(GalleryPhase.NotFound, gallery.state.value.phase)
    }
}
