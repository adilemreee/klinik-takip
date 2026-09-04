package xyz.klinik.network

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import java.io.File
import java.net.InetSocketAddress
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Against a real server on a real socket.
 *
 * The transport is the one class whose whole job is the thing every other test
 * fakes, so faking anything here would test nothing. `com.sun.net.httpserver`
 * ships with the JDK, needs no dependency, and speaks actual HTTP.
 */
class JdkHttpTransportTest {
    private lateinit var server: HttpServer
    private val received = mutableListOf<Recorded>()

    private data class Recorded(
        val method: String,
        val path: String,
        val query: String?,
        val headers: Map<String, String>,
        val body: ByteArray,
    )

    private var respond: (HttpExchange) -> Unit = { exchange -> reply(exchange, 200, "{}") }

    @BeforeTest
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            received += Recorded(
                method = exchange.requestMethod,
                path = exchange.requestURI.path,
                query = exchange.requestURI.query,
                headers = exchange.requestHeaders.entries.associate {
                    it.key.lowercase() to it.value.joinToString(",")
                },
                body = exchange.requestBody.readBytes(),
            )
            respond(exchange)
        }
        server.start()
    }

    @AfterTest
    fun stop() {
        server.stop(0)
    }

    private fun reply(exchange: HttpExchange, status: Int, body: String) {
        val bytes = body.encodeToByteArray()
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun url(path: String) = "http://127.0.0.1:${server.address.port}$path"

    private val transport = JdkHttpTransport()

    @Test
    fun `sends the method, path and headers, and returns the body`() = runTest {
        respond = { reply(it, 200, """{"ok":true}""") }

        val response = transport.send(
            HttpRequest(
                method = "GET",
                url = url("/me/identity"),
                headers = mapOf("Authorization" to "Bearer t0ken", "Accept-Language" to "tr"),
            ),
        )

        assertEquals(200, response.status)
        assertEquals("""{"ok":true}""", response.body)

        val request = received.single()
        assertEquals("GET", request.method)
        assertEquals("/me/identity", request.path)
        assertEquals("Bearer t0ken", request.headers["authorization"])
        assertEquals("tr", request.headers["accept-language"])
    }

    @Test
    fun `sends a JSON body`() = runTest {
        transport.send(
            HttpRequest(
                method = "POST",
                url = url("/auth/login"),
                headers = mapOf("Content-Type" to "application/json"),
                body = """{"identifier":"a@b.test"}""",
            ),
        )

        val request = received.single()
        assertEquals("POST", request.method)
        assertEquals("""{"identifier":"a@b.test"}""", request.body.decodeToString())
        assertEquals("application/json", request.headers["content-type"])
    }

    @Test
    fun `keeps the error body of a failed request`() = runTest {
        // The layer above turns this into the message the user reads. Reading
        // inputStream instead of errorStream on a 4xx throws, and the
        // explanation of what they did wrong would be replaced by a generic
        // failure.
        respond = { reply(it, 422, """{"statusCode":422,"message":["telefon geçersiz"]}""") }

        val response = transport.send(HttpRequest(method = "POST", url = url("/patients"), body = "{}"))

        assertEquals(422, response.status)
        assertContains(response.body, "telefon geçersiz")
    }

    @Test
    fun `keeps the body of a server failure too`() = runTest {
        respond = { reply(it, 500, """{"statusCode":500,"message":"bozuk"}""") }

        val response = transport.send(HttpRequest(method = "GET", url = url("/x")))

        assertEquals(500, response.status)
        assertContains(response.body, "bozuk")
    }

    @Test
    fun `returns response headers, lower-cased`() = runTest {
        // Retry-After decides how long the rate-limit screen waits. HTTP header
        // names are case-insensitive and servers disagree about the casing, so
        // a caller matching on one spelling would silently read nothing.
        respond = { exchange ->
            exchange.responseHeaders.add("Retry-After", "42")
            reply(exchange, 429, "{}")
        }

        val response = transport.send(HttpRequest(method = "GET", url = url("/x")))

        assertEquals("42", response.headers["retry-after"])
    }

    @Test
    fun `an empty response body is empty, not null`() = runTest {
        respond = { exchange ->
            exchange.sendResponseHeaders(204, -1)
            exchange.close()
        }

        val response = transport.send(HttpRequest(method = "DELETE", url = url("/x")))

        assertEquals(204, response.status)
        assertEquals("", response.body)
    }

    @Test
    fun `sends a raw chunk unchanged`() = runTest {
        // A resumable upload chunk. Any transcoding here corrupts the file, and
        // the corruption would only surface when a doctor opened the scan.
        val chunk = ByteArray(256) { (it and 0xFF).toByte() }

        transport.send(
            HttpRequest(
                method = "PUT",
                url = url("/uploads/1"),
                headers = mapOf("Content-Type" to "application/octet-stream"),
                bytes = chunk,
            ),
        )

        assertTrue(chunk.contentEquals(received.single().body))
    }

    @Test
    fun `streams a multipart file with its fields`() = runTest {
        val file = File.createTempFile("klinik", ".bin")
        val content = ByteArray(300_000) { (it and 0x7F).toByte() }
        file.writeBytes(content)

        try {
            transport.send(
                HttpRequest(
                    method = "POST",
                    url = url("/documents"),
                    multipart = MultipartUpload(
                        fields = mapOf("type" to "PASSPORT"),
                        fieldName = "file",
                        path = file.absolutePath,
                        filename = "pasaport.pdf",
                        contentType = "application/pdf",
                    ),
                ),
            )
        } finally {
            file.delete()
        }

        val request = received.single()
        val contentType = request.headers["content-type"].orEmpty()
        assertTrue(contentType.startsWith("multipart/form-data; boundary="), contentType)

        val body = request.body.decodeToString(throwOnInvalidSequence = false)
        assertContains(body, """name="type"""")
        assertContains(body, "PASSPORT")
        assertContains(body, """name="file"; filename="pasaport.pdf"""")
        assertContains(body, "Content-Type: application/pdf")
        // The point of streaming: the whole file arrives, not a truncated
        // prefix of whatever fitted in one buffer.
        assertTrue(
            request.body.size > content.size,
            "expected the ${content.size}-byte file plus its envelope, got ${request.body.size}",
        )
    }

    @Test
    fun `a quote in a filename cannot forge multipart headers`() = runTest {
        // The patient picked this name. Unescaped, the quote closes the
        // filename early and everything after it is read as headers — a way to
        // add form fields the app never sent.
        val file = File.createTempFile("klinik", ".bin")
        file.writeBytes(byteArrayOf(1, 2, 3))

        try {
            transport.send(
                HttpRequest(
                    method = "POST",
                    url = url("/documents"),
                    multipart = MultipartUpload(
                        path = file.absolutePath,
                        filename = "x\"\r\nContent-Disposition: form-data; name=\"role\"\r\n\r\nADMIN",
                        contentType = "application/pdf",
                    ),
                ),
            )
        } finally {
            file.delete()
        }

        val body = received.single().body.decodeToString(throwOnInvalidSequence = false)

        // The hostile text survives verbatim inside the quoted filename — the
        // patient's file really is called that, and mangling it would lose the
        // name. What must not happen is it becoming a header, which is a
        // question of what starts a line.
        val headerLines = body.lines().filter { it.startsWith("Content-Disposition:") }
        assertEquals(1, headerLines.size, "the injected header got a line of its own")
        assertContains(headerLines.single(), """name="file"""")
        assertFalse(
            body.lines().any { it.trim() == "ADMIN" },
            "the injected field value got a line of its own",
        )
        // The quote is escaped rather than ending the filename early.
        assertContains(headerLines.single(), "\\\"")
    }

    @Test
    fun `a repeated response header keeps the last value`() = runTest {
        // The response type holds one value per name, so a choice has to be
        // made. Last wins, matching how a proxy that appends a header expects
        // to override one already there.
        respond = { exchange ->
            exchange.responseHeaders.add("Retry-After", "10")
            exchange.responseHeaders.add("Retry-After", "60")
            reply(exchange, 429, "{}")
        }

        val response = transport.send(HttpRequest(method = "GET", url = url("/x")))

        assertEquals("60", response.headers["retry-after"])
    }

    @Test
    fun `a multipart body is terminated with the closing boundary`() = runTest {
        // Without the trailing "--", the body is an unfinished multipart
        // document: a strict server rejects it, and a lenient one waits for a
        // part that never comes. Either way the patient's upload fails, and the
        // fields and filename all look correct in the bytes that were sent.
        val file = File.createTempFile("klinik", ".bin")
        file.writeBytes(byteArrayOf(1, 2, 3))

        try {
            transport.send(
                HttpRequest(
                    method = "POST",
                    url = url("/documents"),
                    multipart = MultipartUpload(
                        path = file.absolutePath,
                        filename = "x.pdf",
                    ),
                ),
            )
        } finally {
            file.delete()
        }

        val request = received.single()
        val boundary = request.headers["content-type"].orEmpty().substringAfter("boundary=")
        assertTrue(boundary.isNotEmpty(), "no boundary in ${request.headers["content-type"]}")

        val body = request.body.decodeToString(throwOnInvalidSequence = false)
        assertTrue(
            body.endsWith("\r\n--$boundary--\r\n"),
            "body does not end with the closing boundary: ...${body.takeLast(60)}",
        )
    }

    @Test
    fun `a multipart body is streamed rather than buffered`() = runTest {
        // The reason this matters is invisible in the bytes that arrive: a
        // buffered body is byte-for-byte identical, and only differs in having
        // held the whole file in memory to measure it first. On a phone already
        // holding a camera capture that is how the upload screen gets killed.
        //
        // Chunked transfer encoding is the observable consequence, so that is
        // what is asserted.
        val file = File.createTempFile("klinik", ".bin")
        file.writeBytes(ByteArray(200_000))

        try {
            transport.send(
                HttpRequest(
                    method = "POST",
                    url = url("/documents"),
                    multipart = MultipartUpload(path = file.absolutePath, filename = "x.pdf"),
                ),
            )
        } finally {
            file.delete()
        }

        val request = received.single()
        assertEquals("chunked", request.headers["transfer-encoding"])
        assertNull(
            request.headers["content-length"],
            "a measured body means the whole file was buffered to measure it",
        )
    }

    @Test
    fun `an unreachable host is offline, not a server error`() = runTest {
        // The UI shows the offline indicator for this and a retry button for a
        // 5xx. Getting it wrong tells somebody with no signal that the clinic's
        // servers are broken.
        val error = assertFailsWith<ApiError> {
            // .invalid is reserved by RFC 2606 and never resolves.
            transport.send(HttpRequest(method = "GET", url = "http://klinik.invalid/x"))
        }

        assertEquals(ApiError.Offline, error)
    }

    @Test
    fun `a server that never answers times out rather than hanging`() = runTest {
        respond = { exchange ->
            // Longer than the read timeout below; the client gives up first.
            Thread.sleep(2_000)
            reply(exchange, 200, "{}")
        }

        val impatient = JdkHttpTransport(readTimeoutMillis = 300)

        val error = assertFailsWith<ApiError> {
            impatient.send(HttpRequest(method = "GET", url = url("/slow")))
        }

        assertEquals(ApiError.TimedOut, error)
    }

    @Test
    fun `a redirect is returned, not followed`() = runTest {
        // A 30x from this API is a misconfiguration. Following it silently
        // would replay the Authorization header to whatever host the redirect
        // named.
        respond = { exchange ->
            exchange.responseHeaders.add("Location", "http://evil.invalid/steal")
            exchange.sendResponseHeaders(302, -1)
            exchange.close()
        }

        val response = transport.send(
            HttpRequest(
                method = "GET",
                url = url("/x"),
                headers = mapOf("Authorization" to "Bearer secret"),
            ),
        )

        assertEquals(302, response.status)
        assertEquals(1, received.size, "the redirect must not have been followed")
    }
}
