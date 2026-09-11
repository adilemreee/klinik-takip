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
    /**
     * Whether a drawn signature was recorded with it.
     *
     * A consent with one and a consent without are different instruments: the
     * first can be shown to somebody who disputes it, and a screen that did
     * not distinguish them would promise proof the clinic does not hold.
     */
    val hasSignature: Boolean = false,
)

/** The wording to agree to, with this patient's procedure filled in. */
@Serializable
data class ConsentForm(
    val id: String,
    val version: Int,
    /** Markdown. Stored verbatim with the consent, as proof of what was shown. */
    val body: String,
)

/** A short-lived link to the drawn signature. Never stored by the client. */
@Serializable
data class SignatureLink(val url: String, val expiresAt: String)

@Serializable
private data class RecordConsentBody(
    val type: String,
    val version: Int,
    /** The exact text shown, stored as proof of what was agreed to. */
    val documentText: String? = null,
    /** Finger signature as base64 PNG, with no `data:` prefix. */
    val signature: String? = null,
)

class ConsentsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    /** Everything the caller has ever given, withdrawn ones included. */
    suspend fun mine(): List<Consent> =
        decode(client.send(Endpoint(HttpMethod.GET, "me/consents")))

    suspend fun give(
        type: ConsentType,
        version: Int,
        documentText: String? = null,
        signature: String? = null,
    ): Consent =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.POST,
                    "me/consents",
                    body = json.encodeToString(
                        RecordConsentBody.serializer(),
                        RecordConsentBody(type.name, version, documentText, signature),
                    ),
                ),
            ),
        )

    /**
     * The wording to agree to.
     *
     * Fetched rather than shipped in the app: the clinic's lawyer changes this
     * text, and a version compiled into a release is a version somebody signed
     * that nobody can produce afterwards.
     */
    suspend fun form(): ConsentForm =
        decode(client.send(Endpoint(HttpMethod.GET, "me/consents/form")))

    /** A short-lived link to the drawn signature, for either side to look at. */
    suspend fun signature(consentId: String, patientId: String? = null): SignatureLink {
        val path = if (patientId == null) {
            "me/consents/$consentId/signature"
        } else {
            "patients/$patientId/consents/$consentId/signature"
        }

        return decode(client.send(Endpoint(HttpMethod.GET, path)))
    }

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
