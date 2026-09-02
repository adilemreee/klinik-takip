package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
enum class MessageType { TEXT, IMAGE, FILE, AUDIO, SYSTEM, BOT }

@Serializable
enum class MessageStatus {
    /** Written outside the clinic's access window; released when it opens. */
    QUEUED,
    SENT,
    DELIVERED,
    READ,
    FAILED,
    ;

    val stringKey: String get() = "message_status_${name.lowercase()}"
}

@Serializable
data class ChatMessage(
    val id: String,
    val conversationId: String,
    /** Null for clinic or system messages. */
    val senderId: String? = null,
    val type: MessageType = MessageType.TEXT,
    val body: String? = null,
    /** Filled by the AI layer once audio is transcribed (Faz 5). */
    val transcript: String? = null,
    val status: MessageStatus = MessageStatus.SENT,
    /** When a held message will be delivered. */
    val queuedUntil: String? = null,
    val readAt: String? = null,
    val createdAt: String,
) {
    val isQueued: Boolean get() = status == MessageStatus.QUEUED
}

@Serializable
data class MessagePage(
    /** Oldest first, ready to render. */
    val items: List<ChatMessage> = emptyList(),
    /** Pass back to load older messages. */
    val nextCursor: String? = null,
)

@Serializable
data class SentMessage(
    val message: ChatMessage,
    /** Set when the message was held until the clinic opens. */
    val queuedUntil: String? = null,
)

@Serializable
data class ClinicState(val open: Boolean, val opensAt: String? = null)

@Serializable
data class Conversation(
    val id: String,
    val patientId: String,
    val subject: String? = null,
    val lastMessageAt: String? = null,
)

@Serializable
data class Attachment(val mediaKey: String, val mime: String, val size: Int)

@Serializable
data class QuickReply(
    val id: String,
    /** Null for a reply the whole clinic shares. */
    val staffId: String? = null,
    val title: String,
    val body: String,
    val sortOrder: Int = 0,
)

@Serializable
private data class SendBody(
    val body: String? = null,
    val mediaKey: String? = null,
    val type: MessageType? = null,
)

@Serializable
private data class MarkedRead(val marked: Int)

@Serializable
private data class AttachmentLink(val url: String)

class MessagingApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /**
     * Asked before the patient writes, so the compose box can say "queued until
     * 18:00" rather than surprising them after they have sent something.
     */
    suspend fun clinicState(): ClinicState =
        decode(client.send(Endpoint(HttpMethod.GET, "conversations/clinic-state")))

    suspend fun myConversation(): Conversation =
        decode(client.send(Endpoint(HttpMethod.GET, "me/conversation")))

    suspend fun conversation(patientId: String): Conversation =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/conversation")))

    suspend fun inbox(): List<Conversation> =
        decode(client.send(Endpoint(HttpMethod.GET, "conversations")))

    suspend fun messages(
        conversationId: String,
        cursor: String? = null,
        limit: Int? = null,
    ): MessagePage =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "conversations/$conversationId/messages",
                    query = buildMap {
                        cursor?.let { put("cursor", it) }
                        limit?.let { put("limit", it.toString()) }
                    },
                ),
            ),
        )

    suspend fun send(
        conversationId: String,
        body: String?,
        mediaKey: String? = null,
        type: MessageType? = null,
    ): SentMessage =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "conversations/$conversationId/messages",
                    body = json.encodeToString(
                        SendBody.serializer(),
                        SendBody(body, mediaKey, type),
                    ),
                ),
            ),
        )

    suspend fun attach(
        conversationId: String,
        path: String,
        filename: String,
        contentType: String,
    ): Attachment =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "conversations/$conversationId/attachments",
                    multipart = MultipartUpload(
                        path = path,
                        filename = filename,
                        contentType = contentType,
                    ),
                ),
            ),
        )

    suspend fun markRead(conversationId: String): Int =
        decode<MarkedRead>(
            client.send(Endpoint(HttpMethod.POST, "conversations/$conversationId/read")),
        ).marked

    suspend fun attachmentUrl(messageId: String): String =
        decode<AttachmentLink>(
            client.send(Endpoint(HttpMethod.GET, "conversations/messages/$messageId/attachment")),
        ).url

    suspend fun quickReplies(): List<QuickReply> =
        decode(client.send(Endpoint(HttpMethod.GET, "quick-replies")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
