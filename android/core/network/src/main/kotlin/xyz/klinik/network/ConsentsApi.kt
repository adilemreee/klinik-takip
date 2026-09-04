package xyz.klinik.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * What a patient has agreed to (KVKK, spec §8).
 *
 * `DATA_PROCESSING` is in the enum because the server can return one from an
 * older record, and is never offered: processing for treatment rests on KVKK
 * art. 6/3, and Board decision 2026/347 forbids putting a consent text in front
 * of somebody where a non-consent ground applies. [askable] is what keeps a
 * screen from offering it; the server refuses it too.
 */
@Serializable
enum class ConsentType {
    /** The medical procedure consent — a different instrument, signed on paper. */
    TREATMENT,
    DATA_PROCESSING,
    PHOTO_USAGE,
    MARKETING,
    ;

    val stringKey: String get() = "consent.type.$name"
    val explanationKey: String get() = "consent.explain.$name"

    companion object {
        /**
         * The consents a patient may give or withdraw in the app.
         *
         * Asking for the others would suggest a refusal is possible when
         * refusing costs the person their treatment — which makes the consent
         * void, and leaves a record implying the clinic relied on it.
         */
        val askable: List<ConsentType> = listOf(PHOTO_USAGE, MARKETING)
    }
}

@Serializable
data class Consent(
    val id: String,
    val patientId: String,
    val type: ConsentType,
    /** Which wording was agreed to. Without it, "they consented" names nothing. */
    val version: Int,
    val signedAt: String,
    val revokedAt: String? = null,
    val active: Boolean = false,
)

@Serializable
private data class RecordConsentBody(
    val type: String,
    val version: Int,
    val documentText: String? = null,
)

class ConsentsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Everything the caller has ever given, withdrawn ones included. */
    suspend fun mine(): List<Consent> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/consents")))

    suspend fun give(type: ConsentType, version: Int, documentText: String? = null): Consent =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/consents",
                    body = json.encodeToString(
                        RecordConsentBody.serializer(),
                        RecordConsentBody(type.name, version, documentText),
                    ),
                ),
            ),
        )

    /** Forward-only: the record is kept, stamped with when it was withdrawn. */
    suspend fun withdraw(consentId: String): Consent =
        decode(client.send(Endpoint(HttpMethod.DELETE, "me/consents/$consentId")))

    suspend fun forPatient(patientId: String): List<Consent> =
        decode(client.send(Endpoint(HttpMethod.GET, "patients/$patientId/consents")))

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse {
                if (it is ApiError) throw it
                throw ApiError.Decoding(it.message ?: "unreadable response")
            }
}
