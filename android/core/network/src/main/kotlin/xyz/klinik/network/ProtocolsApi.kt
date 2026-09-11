package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The documents the assistant is allowed to answer from (spec M4).
 *
 * This is the only place the clinic decides what the FAQ assistant knows. A
 * document uploaded here is chunked and embedded on the way in, and the
 * assistant answers from these and nothing else — which is why `embedded`
 * being false matters enough to be its own field: the document is stored and
 * the assistant cannot see it.
 */
@Serializable
data class ProtocolDocument(
    val id: String,
    val title: String,
    /** Restricts retrieval to patients who had this procedure. */
    val procedureType: String? = null,
    val language: String,
    val isActive: Boolean = false,
    val createdAt: String,
)

@Serializable
data class ProtocolSummary(
    val document: ProtocolDocument,
    /** How many pieces the document was split into. */
    val chunks: Int = 0,
    /**
     * False when no embedding provider was configured.
     *
     * The document is stored either way, and the assistant cannot retrieve it
     * — so a list that did not show this would show a clinic a protocol its
     * assistant has never read.
     */
    val embedded: Boolean = false,
) {
    val isUsable: Boolean get() = document.isActive && embedded && chunks > 0
}

@Serializable
private data class UploadProtocolBody(
    val title: String,
    val content: String,
    val procedureType: String? = null,
    val language: String = "tr",
)

class ProtocolsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun all(): List<ProtocolSummary> =
        decode(client.send(Endpoint(HttpMethod.GET, "protocols")))

    /** Uploads one. The text is chunked and embedded on the way in. */
    suspend fun upload(
        title: String,
        content: String,
        procedureType: String? = null,
        language: String = "tr",
    ): ProtocolSummary =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "protocols",
                    body = json.encodeToString(
                        UploadProtocolBody.serializer(),
                        UploadProtocolBody(title, content, procedureType, language),
                    ),
                ),
            ),
        )

    /** Withdraws one, so the assistant stops answering from it. */
    suspend fun remove(documentId: String) {
        client.send(Endpoint(HttpMethod.DELETE, "protocols/$documentId"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
