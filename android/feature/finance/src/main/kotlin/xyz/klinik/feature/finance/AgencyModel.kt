package xyz.klinik.feature.finance

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.Agency
import xyz.klinik.network.AgencyEdit
import xyz.klinik.network.ApiError
import xyz.klinik.network.FinanceApi
import xyz.klinik.network.NewAgency
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

sealed interface AgencyPhase {
    data object Loading : AgencyPhase
    data object Loaded : AgencyPhase

    /** None defined. The clinic takes no agency patients, or has not said so. */
    data object Empty : AgencyPhase
    data class Failed(val message: UiText) : AgencyPhase
}

data class AgencyState(
    val phase: AgencyPhase = AgencyPhase.Loading,
    val agencies: List<Agency> = emptyList(),
    val busyId: String? = null,
    val error: UiText? = null,
) {
    val active: List<Agency> get() = agencies.filter { it.isActive }

    /**
     * Switched off, but still on the screen.
     *
     * An agency that stopped sending patients has invoices carrying its
     * commission, and hiding it would leave those naming something a reader
     * cannot look up.
     */
    val inactive: List<Agency> get() = agencies.filterNot { it.isActive }
}

/**
 * Who sends the clinic patients, and on what commission (spec M11).
 *
 * The rate is typed as a percentage and sent as a fraction, because those are
 * two different things and the one a person says out loud is "ten percent".
 * Getting that backwards would multiply an invoice by ten.
 */
class AgencyModel(private val api: FinanceApi) {
    private val _state = MutableStateFlow(AgencyState())
    val state: StateFlow<AgencyState> = _state.asStateFlow()

    suspend fun load() {
        _state.value = _state.value.copy(phase = AgencyPhase.Loading)

        try {
            val agencies = api.agencies().sortedBy { it.name }

            _state.value = AgencyState(
                phase = if (agencies.isEmpty()) AgencyPhase.Empty else AgencyPhase.Loaded,
                agencies = agencies,
            )
        } catch (error: Throwable) {
            _state.value = _state.value.copy(phase = AgencyPhase.Failed(messageFor(error)))
        }
    }

    suspend fun add(
        name: String,
        country: String?,
        contactName: String?,
        contactEmail: String?,
        contactPhone: String?,
        commissionPercent: Int?,
    ): Boolean {
        if (name.isBlank()) return false

        _state.value = _state.value.copy(busyId = NEW, error = null)

        return try {
            val agency = api.addAgency(
                NewAgency(
                    name = name.trim(),
                    country = country?.ifBlank { null },
                    contactName = contactName?.ifBlank { null },
                    contactEmail = contactEmail?.ifBlank { null },
                    contactPhone = contactPhone?.ifBlank { null },
                    commissionRate = commissionPercent?.let { asFraction(it) },
                ),
            )

            _state.value = _state.value.copy(
                phase = AgencyPhase.Loaded,
                agencies = (_state.value.agencies + agency).sortedBy { it.name },
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    /**
     * Switches one off without deleting it.
     *
     * The invoices that named it keep their commission; removing the agency
     * would leave them pointing at nothing.
     */
    suspend fun setActive(agency: Agency, active: Boolean): Boolean {
        _state.value = _state.value.copy(busyId = agency.id, error = null)

        return try {
            val updated = api.updateAgency(agency.id, AgencyEdit(isActive = active))

            _state.value = _state.value.copy(
                agencies = _state.value.agencies.map { if (it.id == updated.id) updated else it },
                busyId = null,
            )

            true
        } catch (error: Throwable) {
            _state.value = _state.value.copy(busyId = null, error = messageFor(error))
            false
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")

    private companion object {
        const val NEW = "new"

        /**
         * Ten percent as `0.1000`.
         *
         * The server wants a fraction with four decimal places and refuses
         * anything else; formatting it here means the clinic types the number
         * it would say out loud.
         */
        fun asFraction(percent: Int): String = "%.4f".format(
            java.util.Locale.ROOT,
            percent.coerceIn(0, 100) / 100.0,
        )
    }
}
