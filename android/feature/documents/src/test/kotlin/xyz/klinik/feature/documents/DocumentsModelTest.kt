package xyz.klinik.feature.documents

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import xyz.klinik.network.ApiClient
import xyz.klinik.network.ApiConfiguration
import xyz.klinik.network.ApiError
import xyz.klinik.network.DocumentType
import xyz.klinik.network.DocumentsApi
import xyz.klinik.network.ErrorResponse
import xyz.klinik.network.HttpRequest
import xyz.klinik.network.HttpResponse
import xyz.klinik.network.HttpTransport
import xyz.klinik.network.InMemoryTokenStore
import xyz.klinik.network.ProcessingStatus
import xyz.klinik.network.ResumableUpload
import xyz.klinik.network.SessionManager
import xyz.klinik.network.SessionTokens
import xyz.klinik.network.TokenRefresher
import xyz.klinik.network.UiText

/**
 * Keyed by method as well as path: the same path lists and uploads, and
 * answering an upload with a list body would hide a decoding failure.
 */
private class RecordingTransport(
    private val bodies: MutableMap<String, Pair<Int, String>>,
    private val delays: Map<String, Long> = emptyMap(),
) : HttpTransport {
    val requests = mutableListOf<String>()
    val uploadedPaths = mutableListOf<String>()

    fun setBody(key: String, value: Pair<Int, String>) {
        bodies[key] = value
    }

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")
        val key = "${request.method} $path"
        requests += key
        request.multipart?.let { uploadedPaths += it.path }

        delays[key]?.let { delay(it) }

        val (status, body) = bodies[key] ?: (500 to "{}")
        return HttpResponse(status, body)
    }
}

private class FailingTransport(private val error: ApiError) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = throw error
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("The document list must not refresh")
}

class DocumentsModelTest {
    private fun page(documents: List<Pair<String, String>>, cursor: String? = null): String {
        val items = documents.joinToString(",") { (id, status) ->
            """
            {"id":"$id","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
             "size":1024,"ocrStatus":"$status","createdAt":"2026-08-28T08:00:00.000Z"}
            """.trimIndent()
        }

        return """{"items":[$items],"nextCursor":${cursor?.let { "\"$it\"" } ?: "null"}}"""
    }

    private val created = """
        {"id":"d1","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
         "size":1024,"ocrStatus":"QUEUED","createdAt":"2026-08-28T08:00:00.000Z","jobId":"j1"}
    """.trimIndent()

    private suspend fun model(transport: HttpTransport): DocumentsModel {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        val client = ApiClient(ApiConfiguration("https://api.test"), transport, session)
        return DocumentsModel(
            DocumentsApi(client),
            ResumableUpload(client),
            "p1",
            // Everything in these tests is small; the resumable path has its
            // own suite.
            resumableThreshold = Long.MAX_VALUE,
        )
    }

    @Test
    fun `loads the list`() = runTest {
        val documents = model(
            RecordingTransport(
                mutableMapOf("GET patients/p1/documents" to (200 to page(listOf("d1" to "DONE")))),
            ),
        )

        documents.load()

        val state = documents.state.value

        assertEquals(DocumentsPhase.Loaded, state.phase)
        assertEquals(listOf("d1"), state.documents.map { it.id })
        assertEquals(ProcessingStatus.DONE, state.documents.first().ocrStatus)
    }

    /** Nothing uploaded yet is not a failure and must not be shown as one. */
    @Test
    fun `reports empty separately from failure`() = runTest {
        val documents = model(
            RecordingTransport(
                mutableMapOf("GET patients/p1/documents" to (200 to page(emptyList()))),
            ),
        )

        documents.load()

        assertEquals(DocumentsPhase.Empty, documents.state.value.phase)
    }

    @Test
    fun `treats not found as its own state`() = runTest {
        val documents = model(FailingTransport(ApiError.NotFound(ErrorResponse(statusCode = 404))))

        documents.load()

        assertEquals(DocumentsPhase.NotFound, documents.state.value.phase)
    }

    /** The file goes up from disk; the envelope is never a request body in memory. */
    @Test
    fun `uploads from a path and reloads`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf(
                "POST patients/p1/documents" to (201 to created),
                "GET patients/p1/documents" to (200 to page(listOf("d1" to "QUEUED"))),
            ),
        )
        val documents = model(transport)

        val uploaded = documents.upload("/tmp/r.pdf", "r.pdf", DocumentType.LAB)

        assertTrue(uploaded)
        assertEquals(listOf("/tmp/r.pdf"), transport.uploadedPaths)
        // Reloaded from the server rather than guessing what was stored.
        assertEquals(
            listOf("POST patients/p1/documents", "GET patients/p1/documents"),
            transport.requests,
        )
    }

    /**
     * A refused upload keeps the server's message, which says what was wrong
     * with the file — ours would only say that something was.
     */
    @Test
    fun `keeps the server message when an upload is refused`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf(
                "POST patients/p1/documents" to (
                    400 to """{"statusCode":400,"message":"File type not allowed here"}"""
                    ),
            ),
        )
        val documents = model(transport)

        val uploaded = documents.upload("/tmp/r.exe", "r.exe", DocumentType.LAB)

        assertFalse(uploaded)
        assertEquals(
            UiText.Literal("File type not allowed here"),
            documents.state.value.uploadError,
        )
    }

    /** A double tap must not upload the same scan twice. */
    @Test
    fun `refuses a second upload while one is in flight`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf(
                "POST patients/p1/documents" to (201 to created),
                "GET patients/p1/documents" to (200 to page(listOf("d1" to "QUEUED"))),
            ),
            delays = mapOf("POST patients/p1/documents" to 500),
        )
        val documents = model(transport)

        val first = async { documents.upload("/tmp/r.pdf", "r.pdf", DocumentType.LAB) }
        val second = async { documents.upload("/tmp/r.pdf", "r.pdf", DocumentType.LAB) }

        val results = listOf(first.await(), second.await())

        assertEquals(1, results.count { it })
        assertEquals(1, transport.requests.count { it == "POST patients/p1/documents" })
    }

    /**
     * The point of polling: a document that finished processing has to stop
     * saying "waiting" without the user reloading the screen.
     */
    @Test
    fun `polling picks up a finished job`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf(
                "GET patients/p1/documents" to (200 to page(listOf("d1" to "QUEUED"))),
            ),
        )
        val documents = model(transport)

        documents.load()
        transport.setBody(
            "GET patients/p1/documents",
            200 to page(listOf("d1" to "DONE")),
        )
        documents.refreshStatuses()

        val state = documents.state.value

        assertEquals(ProcessingStatus.DONE, state.documents.first().ocrStatus)
        assertFalse(state.hasUnsettledWork)
    }

    /**
     * Nothing outstanding means nothing to ask about; polling anyway is a
     * request per screen every few seconds for no information.
     */
    @Test
    fun `does not poll when everything has settled`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf("GET patients/p1/documents" to (200 to page(listOf("d1" to "DONE")))),
        )
        val documents = model(transport)

        documents.load()
        documents.refreshStatuses()

        assertEquals(listOf("GET patients/p1/documents"), transport.requests)
    }

    @Test
    fun `loads the next page`() = runTest {
        val transport = RecordingTransport(
            mutableMapOf(
                "GET patients/p1/documents" to (
                    200 to page(listOf("d1" to "DONE"), cursor = "d1")
                    ),
            ),
        )
        val documents = model(transport)

        documents.load()
        assertTrue(documents.state.value.hasMore)

        transport.setBody("GET patients/p1/documents", 200 to page(listOf("d2" to "DONE")))
        documents.loadMore()

        val state = documents.state.value

        assertEquals(listOf("d1", "d2"), state.documents.map { it.id })
        assertFalse(state.hasMore)
    }
}
