package xyz.klinik.feature.measurements

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import xyz.klinik.network.ApiError
import xyz.klinik.network.BodyChart
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.MeasurementSubject
import xyz.klinik.network.MeasurementsApi
import xyz.klinik.network.NewMeasurement
import xyz.klinik.network.UiText
import xyz.klinik.network.messageKey
import xyz.klinik.network.uiText

sealed interface ChartPhase {
    data object Loading : ChartPhase
    data class Loaded(val chart: BodyChart) : ChartPhase

    /**
     * No reading has ever been recorded. Distinct from an error: nothing is
     * wrong, there is simply nothing to draw yet.
     */
    data object Empty : ChartPhase

    /**
     * The record is not there, or is outside this user's scope. The backend
     * makes those indistinguishable on purpose.
     */
    data object NotFound : ChartPhase

    data class Failed(val messageKey: String) : ChartPhase
}

data class MeasurementsState(
    val phase: ChartPhase = ChartPhase.Loading,
    /** Set while a reading is being saved, so the form can refuse a second tap. */
    val saving: Boolean = false,
    /**
     * Why the last save was refused. A refused reading is described by the
     * server, which names the bound that was crossed; everything else is a key
     * into the string catalogue.
     */
    val saveError: UiText? = null,
)

/** The body-measurement screen: the chart, and recording a new reading. */
class MeasurementsModel(
    private val api: MeasurementsApi,
    private val subject: MeasurementSubject,
    /**
     * How readings this model records are labelled. Staff screens pass NURSE or
     * DEVICE; on the patient's own screen the server sets PATIENT and refuses
     * the field, so this is ignored there.
     */
    private val source: MeasurementSource = MeasurementSource.NURSE,
) {
    private val _state = MutableStateFlow(MeasurementsState())
    val state: StateFlow<MeasurementsState> = _state.asStateFlow()

    /** Serialises saves so a double tap cannot record the same weight twice. */
    private val saveLock = Mutex()

    suspend fun load() {
        _state.value = _state.value.copy(phase = ChartPhase.Loading)
        reload()
    }

    /**
     * Records a reading and redraws from the server's answer.
     *
     * Redrawing rather than appending locally: BMI depends on the height in
     * effect at the time, so a new weight can change more of the curve than the
     * point just added — and a client that guessed would disagree with the
     * chart the clinician is looking at.
     */
    suspend fun record(measurement: NewMeasurement): Boolean {
        if (!saveLock.tryLock()) return false

        _state.value = _state.value.copy(saving = true, saveError = null)

        try {
            api.record(measurement, subject, source)
        } catch (error: Throwable) {
            _state.value = _state.value.copy(
                saving = false,
                // A refused reading is the plausibility check doing its job,
                // and the server's message names the range.
                saveError = (error as? ApiError)?.uiText() ?: UiText.Key("error.server"),
            )
            return false
        } finally {
            saveLock.unlock()
        }

        reload()
        _state.value = _state.value.copy(saving = false)
        return true
    }

    private suspend fun reload() {
        val phase = try {
            val chart = api.chart(subject)
            if (chart.weight.isEmpty() && chart.bmi.isEmpty()) {
                ChartPhase.Empty
            } else {
                ChartPhase.Loaded(chart)
            }
        } catch (error: Throwable) {
            if (error is ApiError.NotFound) {
                ChartPhase.NotFound
            } else {
                ChartPhase.Failed((error as? ApiError)?.messageKey() ?: "error.server")
            }
        }

        _state.value = _state.value.copy(phase = phase)
    }
}
