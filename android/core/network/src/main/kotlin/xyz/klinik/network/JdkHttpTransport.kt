package xyz.klinik.network

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.util.UUID

/**
 * The real transport (T2.2).
 *
 * Built on `HttpURLConnection` rather than OkHttp or Ktor for two reasons: it
 * adds no dependency to an app that ships to patients, and — more usefully —
 * it is plain JDK, so this class compiles and is tested on a laptop with no
 * Android SDK, exactly like the rest of `core:network`. Android's own
 * implementation of it has been OkHttp since 4.4.
 *
 * Streaming is the part worth reading carefully. A clinical document can be
 * 20 MB and the phone is holding the camera capture as well; anything that
 * builds the request or reads the response into one buffer is how an upload
 * screen gets killed by the system just as the patient finally sends the scan.
 * Both directions stream.
 */
class JdkHttpTransport(
    private val connectTimeoutMillis: Int = 15_000,
    private val readTimeoutMillis: Int = 60_000,
    /**
     * Blocking I/O, so it must not run on the caller's thread — on Android
     * that is the main thread and the request would freeze the UI.
     */
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val open: (String) -> HttpURLConnection = { url ->
        URI.create(url).toURL().openConnection() as HttpURLConnection
    },
) : HttpTransport {
    override suspend fun send(request: HttpRequest): HttpResponse = withContext(dispatcher) {
        val connection = try {
            open(request.url)
        } catch (error: IOException) {
            throw asApiError(error)
        }

        try {
            perform(connection, request)
        } catch (error: IOException) {
            throw asApiError(error)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * No status and no body: the request never reached the server, or the
     * answer never came back. Never confused with a 4xx, which *is* an answer.
     *
     * The two are separated because the UI offers different remedies — the
     * offline indicator (spec M15) versus "try again" — and because only one of
     * them means the request may already have been carried out.
     */
    private fun asApiError(error: IOException): ApiError = when (error) {
        is SocketTimeoutException -> ApiError.TimedOut
        else -> ApiError.Offline
    }

    private fun perform(connection: HttpURLConnection, request: HttpRequest): HttpResponse {
        connection.requestMethod = request.method
        connection.connectTimeout = connectTimeoutMillis
        connection.readTimeout = readTimeoutMillis
        // Redirects are not followed: a 30x from an API is a misconfiguration,
        // and following one silently can replay an Authorization header to a
        // host we never meant to send it to.
        connection.instanceFollowRedirects = false

        for ((name, value) in request.headers) {
            connection.setRequestProperty(name, value)
        }

        writeBody(connection, request)

        val status = connection.responseCode
        // errorStream carries the body of a 4xx/5xx; inputStream throws for
        // those. Dropping it would throw away the server's explanation of what
        // the user did wrong.
        val stream = if (status in 200..399) connection.inputStream else connection.errorStream

        return HttpResponse(
            status = status,
            body = stream?.use { it.readBytes().decodeToString() }.orEmpty(),
            headers = headersOf(connection),
        )
    }

    /**
     * The response headers, lower-cased, one value per name.
     *
     * Read by index rather than from `headerFields`. That map is documented as
     * unordered, and the JDK in fact returns repeated values newest-first while
     * another implementation — Android's, which is OkHttp — need not. The
     * indexed accessors walk the headers in the order they arrived, so "a
     * repeated header keeps the last value" is a property of this code rather
     * than of whichever HTTP stack is underneath.
     *
     * Lower-cased because HTTP field names are case-insensitive and servers
     * disagree about the casing; a caller matching on one spelling would
     * otherwise silently read nothing.
     */
    private fun headersOf(connection: HttpURLConnection): Map<String, String> {
        val headers = mutableMapOf<String, String>()

        var index = 0
        while (true) {
            val name = connection.getHeaderFieldKey(index)
            val value = connection.getHeaderField(index)

            // Both null means the end. A null name with a value is the status
            // line, which is not a header.
            if (name == null && value == null) break
            if (name != null && value != null) headers[name.lowercase()] = value

            index += 1
        }

        return headers
    }

    private fun writeBody(connection: HttpURLConnection, request: HttpRequest) {
        val multipart = request.multipart

        when {
            multipart != null -> {
                val boundary = "----klinik${UUID.randomUUID().toString().replace("-", "")}"
                connection.setRequestProperty(
                    "Content-Type",
                    "multipart/form-data; boundary=$boundary",
                )
                connection.doOutput = true
                // Without this the connection buffers the whole body in memory
                // to work out Content-Length — the exact thing being avoided.
                connection.setChunkedStreamingMode(STREAM_CHUNK_BYTES)
                BufferedOutputStream(connection.outputStream).use { writeMultipart(it, boundary, multipart) }
            }

            request.bytes != null -> {
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(request.bytes.size)
                connection.outputStream.use { it.write(request.bytes) }
            }

            request.body != null -> {
                val encoded = request.body.encodeToByteArray()
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(encoded.size)
                connection.outputStream.use { it.write(encoded) }
            }
        }
    }

    private fun writeMultipart(out: OutputStream, boundary: String, upload: MultipartUpload) {
        for ((name, value) in upload.fields) {
            out.writeAscii("--$boundary\r\n")
            out.writeAscii("Content-Disposition: form-data; name=\"${escapeQuotes(name)}\"\r\n\r\n")
            out.write(value.encodeToByteArray())
            out.writeAscii("\r\n")
        }

        out.writeAscii("--$boundary\r\n")
        out.writeAscii(
            "Content-Disposition: form-data; name=\"${escapeQuotes(upload.fieldName)}\"; " +
                "filename=\"${escapeQuotes(upload.filename)}\"\r\n",
        )
        out.writeAscii("Content-Type: ${upload.contentType}\r\n\r\n")

        File(upload.path).inputStream().use { it.copyToStreaming(out) }

        out.writeAscii("\r\n--$boundary--\r\n")
        out.flush()
    }

    private fun InputStream.copyToStreaming(out: OutputStream) {
        val buffer = ByteArray(STREAM_CHUNK_BYTES)
        while (true) {
            val read = read(buffer)
            if (read < 0) break
            out.write(buffer, 0, read)
        }
    }

    private fun OutputStream.writeAscii(text: String) = write(text.encodeToByteArray())

    /**
     * A filename containing a quote or a newline would otherwise end the header
     * early and let the rest be read as headers of its own. The patient chose
     * this name, so it is untrusted input.
     */
    private fun escapeQuotes(value: String): String =
        value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "")
            .replace("\n", "")

    private companion object {
        const val STREAM_CHUNK_BYTES = 64 * 1024
    }
}
