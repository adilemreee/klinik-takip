package xyz.klinik.app

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import xyz.klinik.feature.auth.ui.AuthStrings
import xyz.klinik.feature.home.ui.HomeStrings
import xyz.klinik.feature.patients.ui.PatientStrings
import xyz.klinik.network.UserRole

/**
 * Turns catalogue keys into text, once, at the edge.
 *
 * The screens take their strings as a parameter rather than calling
 * `stringResource` themselves — that is what keeps them in modules with no
 * Android dependency and testable without a device. The cost is this file, and
 * it is worth paying.
 */

/**
 * `error.timedOut` → `R.string.error_timed_out`.
 *
 * The models produce dotted, camel-cased keys because they are shared with iOS,
 * where that is the convention. Resolving by name rather than keeping a `when`
 * of every key means a key added to a model does not silently fall back to a
 * generic message here — it either resolves or is caught by
 * [StringCatalogueTest].
 */
fun Context.stringForKey(key: String, fallback: String = key): String {
    val name = key
        .replace('.', '_')
        .replace(Regex("([a-z0-9])([A-Z])"), "$1_$2")
        .lowercase()

    @Suppress("DiscouragedApi")
    val id = resources.getIdentifier(name, "string", packageName)

    return if (id == 0) fallback else getString(id)
}

fun Context.stringForRole(role: UserRole): String = stringForKey(role.stringKey, role.name)

@Composable
fun authStrings(errorKey: String?): AuthStrings {
    val context = LocalContext.current

    return AuthStrings(
        signIn = str(R.string.auth_sign_in),
        identifier = str(R.string.auth_identifier),
        password = str(R.string.auth_password),
        twoFactorTitle = str(R.string.auth_two_factor_title),
        twoFactorHint = str(R.string.auth_two_factor_hint),
        twoFactorSetupTitle = str(R.string.auth_two_factor_setup_title),
        twoFactorSetupHint = str(R.string.auth_two_factor_setup_hint),
        done = str(R.string.common_done),
        error = errorKey?.let { context.stringForKey(it) },
    )
}

@Composable
fun homeStrings(displayName: String): HomeStrings {
    val context = LocalContext.current

    return HomeStrings(
        greeting = "${str(R.string.home_title)}, $displayName",
        nextAppointment = str(R.string.home_next_appointment),
        noPatientFile = str(R.string.home_no_patient_file),
        retry = str(R.string.common_retry),
        cancel = str(R.string.common_cancel),
        close = str(R.string.common_close),
        actionTitle = { action -> context.stringForKey(action.titleKey) },
        emergencyConfirmTitle = str(R.string.emergency_confirm_title),
        emergencyConfirmHint = str(R.string.emergency_confirm_hint),
        emergencyConfirmAction = str(R.string.emergency_confirm_action),
        emergencySending = str(R.string.emergency_sending),
        emergencySent = str(R.string.emergency_sent),
        message = { key -> context.stringForKey(key) },
    )
}

@Composable
fun patientStrings(): PatientStrings = PatientStrings(
    searchHint = str(R.string.patient_search_hint),
    empty = str(R.string.patient_empty),
    fileNumber = str(R.string.patient_file_number),
    retry = str(R.string.common_retry),
    loading = str(R.string.common_loading),
    notFound = str(R.string.patient_not_found),
    country = str(R.string.patient_country),
    city = str(R.string.patient_city),
)

@Composable
private fun str(@StringRes id: Int): String = stringResource(id)
