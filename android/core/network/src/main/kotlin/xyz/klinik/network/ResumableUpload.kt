package xyz.klinik.network

import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class UploadSession(
    val id: String,
    /** The offset to send next. The whole protocol turns on this number. */
    val receivedBytes: Int,
    val status: String,
    val mime: String? = null,
    val expiresAt: String,
    val documentId: String? = null,
)

/** How much of a file has reached the server, for a progress bar. */
data class UploadProgress(val sent: Long, val total: Long) {
    val fraction: Double get() = if (total == 0L) 0.0 else sent.toDouble() / total.toDouble()
}

@Serializable
private data class BeginBody(val type: String, val originalName: String? = null)

@Serializable
private data class CompleteBody(val checksum: String)

/**
 * Chunked, resumable upload (spec section 9).
 *
 * Single-shot upload is fine on the clinic's own network. It is not fine for
 * the patient this product is for: abroad, on mobile data, sending a 20 MB
 * scan. Losing the connection at 18 MB and starting over is how a document ends
 * up never being sent.
 */
class ResumableUpload(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    companion object {
        /**
         * One megabyte: small enough that losing a chunk costs little on a bad
         * connection, large enough that a 20 MB file is twenty requests rather
         * than two thousand.
         */
        const val CHUNK_SIZE = 1024 * 1024

        /** Hashed in chunks: a 20 MB file must not be resident in memory. */
        fun checksum(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")

            file.inputStream().use { stream ->
                val buffer = ByteArray(256 * 1024)

                while (true) {
                    val read = stream.read(buffer)
                    if (read <= 0) break
                    digest.update(buffer, 0, read)
                }
            }

            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }

    suspend fun begin(
        subject: RecordSubject,
        type: DocumentType,
        originalName: String? = null,
    ): UploadSession =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    subject.base("documents/uploads"),
                    body = json.encodeToString(
                        BeginBody.serializer(),
                        BeginBody(type.name, originalName),
                    ),
                ),
            ),
        )

    suspend fun status(sessionId: String): UploadSession =
        decode(client.send(Endpoint(HttpMethod.GET, "documents/uploads/$sessionId")))

    /**
     * Sends the file from `startOffset` onwards, resuming after interruptions.
     *
     * A rejected offset is not an error to surface: the server knows how much
     * it has, so the client asks and carries on from there. Guessing would
     * leave a hole in the file that nothing downstream notices until a doctor
     * opens a corrupt PDF.
     */
    suspend fun send(
        file: File,
        sessionId: String,
        startOffset: Long = 0,
        onProgress: ((UploadProgress) -> Unit)? = null,
    ): UploadSession {
        val total = file.length()
        var offset = startOffset
        var last: UploadSession? = null

        RandomAccessFile(file, "r").use { handle ->
            while (offset < total) {
                handle.seek(offset)

                val size = minOf(CHUNK_SIZE.toLong(), total - offset).toInt()
                val chunk = ByteArray(size)
                handle.readFully(chunk)

                try {
                    last = decode(
                        client.send(
                            Endpoint(
                                HttpMethod.PATCH,
                                "documents/uploads/$sessionId",
                                query = mapOf("offset" to offset.toString()),
                                bytes = chunk,
                                contentType = "application/octet-stream",
                            ),
                        ),
                    )
                    offset += size
                } catch (error: ApiError.Conflict) {
                    // The server is somewhere else — behind us if a chunk was
                    // lost, ahead if a success reply was. Either way it is the
                    // authority on how much it holds.
                    val current = status(sessionId)
                    last = current

                    if (current.receivedBytes.toLong() == offset) throw error

                    offset = current.receivedBytes.toLong()
                    continue
                }

                onProgress?.invoke(UploadProgress(offset, total))
            }
        }

        return last ?: status(sessionId)
    }

    /**
     * Completes the upload, checked against a hash of the file on disk.
     *
     * The server hashes what arrived; this hashes what was read. A mismatch
     * means the assembled file is not the one the patient chose, and the server
     * refuses it rather than filing a corrupt document.
     */
    suspend fun complete(sessionId: String, file: File): UploadedDocument =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "documents/uploads/$sessionId/complete",
                    body = json.encodeToString(
                        CompleteBody.serializer(),
                        CompleteBody(checksum(file)),
                    ),
                ),
            ),
        )

    suspend fun abort(sessionId: String) {
        client.send(Endpoint(HttpMethod.DELETE, "documents/uploads/$sessionId"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
