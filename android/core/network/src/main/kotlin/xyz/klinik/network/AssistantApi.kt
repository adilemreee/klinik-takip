package xyz.klinik.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Why a question went to a person instead of being answered. */
@Serializable
enum class HandoverReason {
    /** Nothing in the clinic's documents was about this. */
    @SerialName("no-sources")
    NO_SOURCES,

    /** The documents were retrieved, but the model said they do not answer it. */
    @SerialName("model-declined")
    MODEL_DECLINED,

    /** The answer did not point at anything it was given, so it was discarded. */
    @SerialName("no-citations")
    NO_CITATIONS,

    @SerialName("ai-unavailable")
    AI_UNAVAILABLE,
    ;

    /**
     * One message for all of them, on purpose.
     *
     * A patient does not need to know which internal check declined; they need
     * to know a person is reading it. Explaining the difference would invite
     * them to rephrase until the bot answers, which is the opposite of what
     * these checks are for.
     */
    val stringKey: String get() = "assistant_handover"
}

@Serializable
data class AssistantResult(
    /** The stored question — the handle for "this answer is not enough". */
    val questionMessageId: String,
    val answered: Boolean = false,
    val answer: String? = null,
    /** Clinic documents the answer came from. */
    val sources: List<String> = emptyList(),
    val handoverReason: HandoverReason? = null,
)

@Serializable
private data class AskBody(val question: String)

class AssistantApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Asks the FAQ assistant. It answers only from the clinic's own documents. */
    suspend fun ask(question: String): AssistantResult =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/assistant/ask",
                    body = json.encodeToString(AskBody.serializer(), AskBody(question)),
                ),
            ),
        )

    /** "This answer is not enough, send it to a doctor." */
    suspend fun escalate(messageId: String) {
        client.send(Endpoint(HttpMethod.POST, "me/assistant/$messageId/escalate"))
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
