package xyz.klinik.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The readings the clinic tracks. The serial names are the wire format and are
 * never shown to anyone; the labels come from the string catalogue.
 */
@Serializable
enum class MeasurementType {
    WEIGHT,
    HEIGHT,
    BLOOD_PRESSURE,
    PULSE,
    TEMPERATURE,
    SPO2,
    GLUCOSE,
    WAIST,
    ;

    /** Blood pressure is the only reading that carries a second number. */
    val hasSecondaryValue: Boolean get() = this == BLOOD_PRESSURE

    val stringKey: String get() = "measurement_type_${name.lowercase()}"
}

@Serializable
enum class MeasurementSource {
    PATIENT,
    NURSE,
    DEVICE,
    ;

    val stringKey: String get() = "measurement_source_${name.lowercase()}"
}

@Serializable
data class MeasurementPoint(
    val measuredAt: String,
    val value: Double,
    /** Diastolic, for blood pressure; null for everything else. */
    val secondaryValue: Double? = null,
    val unit: String,
    val source: MeasurementSource,
)

@Serializable
enum class BmiCategory {
    UNDERWEIGHT,
    NORMAL,
    OVERWEIGHT,
    @SerialName("OBESE_I") OBESE_I,
    @SerialName("OBESE_II") OBESE_II,
    @SerialName("OBESE_III") OBESE_III,
    ;

    val stringKey: String get() = "bmi_category_${name.lowercase()}"
}

@Serializable
data class BmiPoint(
    val measuredAt: String,
    val bmi: Double,
    val category: BmiCategory,
    val weightKg: Double,
    /** The height in effect when that weight was taken, not the latest one. */
    val heightCm: Double,
)

/**
 * Everything the body-measurement screen draws, in one response: the backend
 * composes it so the curve and its goal line cannot come from two different
 * reads of the record.
 */
@Serializable
data class BodyChart(
    val weight: List<MeasurementPoint> = emptyList(),
    val bmi: List<BmiPoint> = emptyList(),
    /**
     * Null when no goal has been set — the chart then draws no line, rather
     * than a line at zero.
     */
    val targetWeightKg: Double? = null,
    val targetBmi: Double? = null,
)

@Serializable
data class NewMeasurement(
    val type: MeasurementType,
    val value: Double,
    val secondaryValue: Double? = null,
    val measuredAt: String? = null,
    val note: String? = null,
    /**
     * Set only on the staff path. On `me/measurements` the server refuses the
     * field outright rather than quietly rewriting it, so it must be absent —
     * which the encoder omits, since nulls are not written by default.
     */
    val source: MeasurementSource? = null,
)

/**
 * Staff record against a named patient; a patient records against themselves.
 * The two paths are separate on the server because the source is not the
 * caller's to choose.
 */
sealed interface MeasurementSubject {
    data class OfPatient(val id: String) : MeasurementSubject
    data object Mine : MeasurementSubject

    val basePath: String
        get() = when (this) {
            is OfPatient -> "patients/$id/measurements"
            Mine -> "me/measurements"
        }
}

class MeasurementsApi(
    private val client: ApiClient,
    private val json: Json = ApiClient.defaultJson,
) {
    suspend fun chart(subject: MeasurementSubject): BodyChart =
        decode(client.send(Endpoint(HttpMethod.GET, "${subject.basePath}/chart")))

    suspend fun series(
        subject: MeasurementSubject,
        type: MeasurementType,
        from: String? = null,
    ): List<MeasurementPoint> =
        decode(
            client.send(
                Endpoint(
                    HttpMethod.GET,
                    "${subject.basePath}/${type.name}",
                    query = from?.let { mapOf("from" to it) } ?: emptyMap(),
                ),
            ),
        )

    suspend fun latest(subject: MeasurementSubject): Map<String, MeasurementPoint> =
        decode(client.send(Endpoint(HttpMethod.GET, "${subject.basePath}/latest")))

    suspend fun record(
        measurement: NewMeasurement,
        subject: MeasurementSubject,
        source: MeasurementSource = MeasurementSource.NURSE,
    ) {
        val payload = when (subject) {
            is MeasurementSubject.OfPatient -> measurement.copy(source = source)
            MeasurementSubject.Mine -> measurement.copy(source = null)
        }

        client.send(
            Endpoint(
                HttpMethod.POST,
                subject.basePath,
                body = json.encodeToString(NewMeasurement.serializer(), payload),
            ),
        )
    }

    private inline fun <reified T> decode(body: String): T =
        runCatching { json.decodeFromString<T>(body) }
            .getOrElse { throw ApiError.Decoding(it.message ?: "unreadable response") }
}
