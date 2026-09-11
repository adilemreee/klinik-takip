package xyz.klinik.feature.patients

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import xyz.klinik.network.ApiError
import xyz.klinik.network.NewPatient
import xyz.klinik.network.Patient
import xyz.klinik.network.PatientsApi
import xyz.klinik.network.UiText
import xyz.klinik.network.uiText

/** What the form holds before it is sent. */
data class NewPatientDraft(
    val firstName: String = "",
    val lastName: String = "",
    val birthDate: String = "",
    val sex: String = "FEMALE",
    val country: String = "",
    val city: String = "",
    val referralSource: String = "",
)

/** Why the form would be refused, before it is sent. */
sealed interface NewPatientProblem {
    data object NoName : NewPatientProblem
    data object BadCountry : NewPatientProblem

    val stringKey: String
        get() = when (this) {
            NoName -> "patient.needName"
            BadCountry -> "patient.needCountry"
        }
}

data class NewPatientState(
    val draft: NewPatientDraft = NewPatientDraft(),
    val busy: Boolean = false,
    /** The file that was opened, so the screen can say which. */
    val created: Patient? = null,
    val error: UiText? = null,
) {
    val problems: List<NewPatientProblem>
        get() = buildList {
            if (draft.firstName.isBlank() || draft.lastName.isBlank()) add(NewPatientProblem.NoName)

            // Two letters, because it is an ISO 3166-1 alpha-2 code and the
            // server refuses anything else — after the form was filled in.
            if (draft.country.trim().length != 2) add(NewPatientProblem.BadCountry)
        }

    val canSubmit: Boolean get() = problems.isEmpty() && !busy && draft.birthDate.isNotBlank()
}

/**
 * Opening a file (spec M2).
 *
 * The five required fields are required by the server, and the form says so
 * while somebody types rather than after they submit. Country is one of them
 * because it decides the language the patient is written to in and which
 * discharge advice they get — a file with no country is one the clinic has to
 * guess about.
 *
 * Nothing clinical is asked for here. A file is opened with an identity; what
 * was operated on and when belongs to the record, not to the moment somebody
 * writes a name down.
 */
class NewPatientModel(private val api: PatientsApi) {
    private val _state = MutableStateFlow(NewPatientState())
    val state: StateFlow<NewPatientState> = _state.asStateFlow()

    fun edit(change: NewPatientDraft.() -> NewPatientDraft) {
        _state.value = _state.value.copy(draft = _state.value.draft.change(), error = null)
    }

    suspend fun create(): Patient? {
        if (!_state.value.canSubmit) return null

        val draft = _state.value.draft

        _state.value = _state.value.copy(busy = true, error = null)

        return try {
            val patient = api.create(
                NewPatient(
                    firstName = draft.firstName.trim(),
                    lastName = draft.lastName.trim(),
                    birthDate = draft.birthDate.trim(),
                    sex = draft.sex,
                    country = draft.country.trim().uppercase(),
                    city = draft.city.trim().ifEmpty { null },
                    referralSource = draft.referralSource.trim().ifEmpty { null },
                ),
            )

            _state.value = _state.value.copy(busy = false, created = patient)
            patient
        } catch (error: Throwable) {
            // The form stays filled in. Retyping a name and a date of birth
            // because the network dropped is how records get entered twice.
            _state.value = _state.value.copy(busy = false, error = messageFor(error))
            null
        }
    }

    private fun messageFor(error: Throwable): UiText =
        (error as? ApiError)?.uiText() ?: UiText.Key("error.server")
}
