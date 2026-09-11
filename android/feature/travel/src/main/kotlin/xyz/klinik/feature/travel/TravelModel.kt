package xyz.klinik.feature.travel

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.TravelApi
import xyz.klinik.network.TravelPlan
import xyz.klinik.network.TravelPlanView
import xyz.klinik.network.UiText
import xyz.klinik.network.UpsertTravelPlan
import xyz.klinik.network.uiText

sealed interface TravelPhase {
    data object Loading : TravelPhase
    data object Loaded : TravelPhase

    /** Nothing entered yet. A real state, and different from a failure. */
    data object None : TravelPhase
    data class Failed(val message: UiText) : TravelPhase
}

data class TravelState(
    val phase: TravelPhase = TravelPhase.Loading,
    val view: TravelPlanView? = null,
    val draft: UpsertTravelPlan = UpsertTravelPlan(),
    val editing: Boolean = false,
    val busy: Boolean = false,
    val error: UiText? = null,
) {
    val plan: TravelPlan? get() = view?.plan
    val isClearedToFly: Boolean get() = plan?.isClearedToFly == true
    val clearedBy: String? get() = view?.clearedToFlyBy
}

/**
 * Getting the patient here and home again (spec M14).
 *
 * Almost all of this is logistics a coordinator owns — a flight, a hotel,
 * somebody at the airport. Exactly one field is not: whether a clinician has
 * said the patient may fly. It is saved through its own call rather than with
 * the rest of the form, so a coordinator editing a hotel address can never
 * carry a medical decision along with it.
 */
class TravelModel(
    private val api: TravelApi,
    /** Null on the patient's own screen, which is read-only. */
    private val patientId: String? = null,
) {
    private val _state = MutableStateFlow(TravelState())
    val state: StateFlow<TravelState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = TravelPhase.Loading)

        try {
            val view = if (patientId == null) api.mine() else api.forPatient(patientId)
            val plan = view.plan

            _state.value = TravelState(
                phase = if (plan == null || plan.isEmpty) TravelPhase.None else TravelPhase.Loaded,
                view = view,
                draft = plan.toDraft(),
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = TravelPhase.Failed(messageFor(error)))
        }
    }

    fun beginEditing() {
        _state.value = _state.value.copy(
            editing = true,
            draft = _state.value.plan.toDraft(),
            error = null,
        )
    }

    fun cancelEditing() {
        _state.value = _state.value.copy(editing = false, error = null)
    }

    fun edit(change: UpsertTravelPlan.() -> UpsertTravelPlan) {
        _state.value = _state.value.copy(draft = _state.value.draft.change())
    }

    suspend fun save(): Boolean {
        val target = patientId ?: return false

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            val view = api.save(target, _state.value.draft)

            _state.value = _state.value.copy(
                phase = if (view.plan?.isEmpty != false) TravelPhase.None else TravelPhase.Loaded,
                view = view,
                draft = view.plan.toDraft(),
                editing = false,
                busy = false,
            )

            true
        } catch (error: Throwable) {
            // The form stays open with what was typed. A conflict here means
            // somebody else saved first, and throwing the entry away would
            // lose the second coordinator's work as well as the first's.
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    /**
     * A clinician's signature on the flight home.
     *
     * Its own call, and a coordinator without the permission is told so by the
     * server rather than being offered a switch that silently does nothing.
     */
    suspend fun setClearedToFly(cleared: Boolean): Boolean {
        val target = patientId ?: return false

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            val view = api.setClearedToFly(target, cleared)

            _state.value = _state.value.copy(view = view, busy = false)
            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}

/**
 * The saved plan as a form.
 *
 * `expectedVersion` travels with it: two coordinators arranging one patient's
 * travel is the ordinary case here, and a second save winning silently would
 * lose the first's flight number.
 */
private fun TravelPlan?.toDraft(): UpsertTravelPlan = UpsertTravelPlan(
    arrivalFlight = this?.arrivalFlight,
    arrivalAt = this?.arrivalAt,
    departureFlight = this?.departureFlight,
    departureAt = this?.departureAt,
    hotelName = this?.hotelName,
    hotelAddress = this?.hotelAddress,
    hotelCheckIn = this?.hotelCheckIn,
    hotelCheckOut = this?.hotelCheckOut,
    greeterName = this?.greeterName,
    greeterPhone = this?.greeterPhone,
    transferNote = this?.transferNote,
    interpreterName = this?.interpreterName,
    interpreterLanguage = this?.interpreterLanguage,
    interpreterPhone = this?.interpreterPhone,
    notes = this?.notes,
    expectedVersion = this?.version,
)
