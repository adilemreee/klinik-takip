package xyz.klinik.network

import java.io.File
import java.security.MessageDigest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.io.path.createTempDirectory
import kotlinx.coroutines.test.runTest

/** A server that loses a chunk, or loses a reply, the way a bad connection does. */
private class FlakyUploadServer(
    /**
     * Chunk indices to accept and then pretend never arrived — the reply is
     * lost, so the client believes it failed and the server does not.
     */
    private val dropReplies: Set<Int> = emptySet(),
    preloaded: ByteArray = ByteArray(0),
) : HttpTransport {
    var received: ByteArray = preloaded
        private set
    var patchCount = 0
        private set
    var statusCalls = 0
        private set

    private fun session() = """
        {"id":"s1","receivedBytes":${received.size},"status":"ACTIVE",
         "mime":"application/pdf","expiresAt":"2026-12-31T00:00:00.000Z","documentId":null}
    """.trimIndent()

    override suspend fun send(request: HttpRequest): HttpResponse {
        val path = request.url.substringAfter("https://api.test/").substringBefore("?")

        if (request.method == "PATCH") {
            val index = patchCount
            patchCount += 1

            val offset = Regex("offset=(\\d+)").find(request.url)?.groupValues?.get(1)?.toInt() ?: 0

            if (offset != received.size) {
                return HttpResponse(409, """{"message":"OFFSET_MISMATCH"}""")
            }

            if (dropReplies.contains(index)) {
                received += request.bytes ?: ByteArray(0)
                return HttpResponse(409, """{"message":"lost"}""")
            }

            received += request.bytes ?: ByteArray(0)
            return HttpResponse(200, session())
        }

        if (path.endsWith("/complete")) {
            return HttpResponse(
                201,
                """
                {"id":"d1","type":"LAB","originalName":"r.pdf","mime":"application/pdf",
                 "size":${received.size},"ocrStatus":"QUEUED",
                 "createdAt":"2026-08-29T08:00:00.000Z","jobId":"j1"}
                """.trimIndent(),
            )
        }

        if (request.method == "GET") {
            statusCalls += 1
            return HttpResponse(200, session())
        }

        return HttpResponse(201, session())
    }
}

private object UnusedRefresher : TokenRefresher {
    override suspend fun refresh(refreshToken: String): SessionTokens =
        error("An upload must not refresh")
}

class ResumableUploadTest {
    private val folder = createTempDirectory("klinik-ru").toFile().also { it.deleteOnExit() }

    private fun file(bytes: Int): File {
        val created = File(folder, "scan-${System.nanoTime()}.pdf")
        val content = ByteArray(bytes) { 0x41 }
        "%PDF-1.7\n".toByteArray().copyInto(content)
        created.writeBytes(content)
        return created
    }

    private suspend fun uploader(transport: HttpTransport): ResumableUpload {
        val session = SessionManager(InMemoryTokenStore(), UnusedRefresher)
        session.signIn(SessionTokens("access", "refresh", System.currentTimeMillis() + 900_000))
        return ResumableUpload(ApiClient(ApiConfiguration("https://api.test"), transport, session))
    }

    /** The bytes that arrive in pieces are the bytes that were on disk. */
    @Test
    fun `sends the whole file in chunks`() = runTest {
        val source = file(3 * ResumableUpload.CHUNK_SIZE + 512)
        val server = FlakyUploadServer()

        uploader(server).send(source, "s1")

        assertContentEquals(source.readBytes(), server.received)
        assertEquals(4, server.patchCount)
    }

    /**
     * The case the feature exists for: the client comes back with a stale idea
     * of how much arrived — an app relaunched, an attempt from an hour ago —
     * and the server is ahead of it. It asks rather than guessing, because
     * guessing leaves a hole nothing notices until a doctor opens a corrupt PDF.
     */
    @Test
    fun `resumes when the server is ahead of the client`() = runTest {
        val source = file(3 * ResumableUpload.CHUNK_SIZE)
        val content = source.readBytes()
        val server = FlakyUploadServer(
            preloaded = content.copyOfRange(0, ResumableUpload.CHUNK_SIZE),
        )

        uploader(server).send(source, "s1", startOffset = 0)

        assertContentEquals(content, server.received)
        assertTrue(server.statusCalls >= 1)
    }

    /**
     * A reply lost in transit is the nastiest case: the server has the chunk
     * and the client does not know. Re-sending blindly would duplicate it.
     */
    @Test
    fun `does not duplicate a chunk whose reply was lost`() = runTest {
        val source = file(2 * ResumableUpload.CHUNK_SIZE)
        val server = FlakyUploadServer(dropReplies = setOf(0))

        uploader(server).send(source, "s1")

        assertContentEquals(source.readBytes(), server.received)
        assertEquals(2 * ResumableUpload.CHUNK_SIZE, server.received.size)
    }

    /** Resuming sends the remainder, not the file again — the entire saving. */
    @Test
    fun `sends only the remainder when resuming`() = runTest {
        val source = file(3 * ResumableUpload.CHUNK_SIZE)
        val content = source.readBytes()
        val server = FlakyUploadServer(
            preloaded = content.copyOfRange(0, 2 * ResumableUpload.CHUNK_SIZE),
        )

        uploader(server).send(source, "s1", startOffset = 2L * ResumableUpload.CHUNK_SIZE)

        assertEquals(1, server.patchCount)
        assertContentEquals(content, server.received)
    }

    @Test
    fun `reports progress as it goes`() = runTest {
        val source = file(3 * ResumableUpload.CHUNK_SIZE)
        val server = FlakyUploadServer()
        val fractions = mutableListOf<Double>()

        uploader(server).send(source, "s1") { fractions += it.fraction }

        assertEquals(3, fractions.size)
        assertEquals(1.0, fractions.last(), 0.0001)
    }

    /** Hashed in chunks so a 20 MB file is never resident in memory. */
    @Test
    fun `checksum matches the file on disk`() = runTest {
        val source = file(300_000)
        val expected = MessageDigest.getInstance("SHA-256")
            .digest(source.readBytes())
            .joinToString("") { "%02x".format(it) }

        assertEquals(expected, ResumableUpload.checksum(source))
    }
}
