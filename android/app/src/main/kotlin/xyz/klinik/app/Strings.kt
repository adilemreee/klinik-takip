package xyz.klinik.app

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import xyz.klinik.shell.PasswordRules
import xyz.klinik.design.klinikStringIds
import xyz.klinik.feature.auth.ui.AuthStrings
import xyz.klinik.feature.home.ui.HomeStrings
import xyz.klinik.feature.patients.ui.PatientStrings
import xyz.klinik.network.UserRole
// Design-system resources live in their own R class, not the app's: since AGP
// 8 the R class is non-transitive, so a library's resources are namespaced to
// that library rather than merged into every module that depends on it. Only
// `app_name`, declared here, is in the app's own R.
import xyz.klinik.design.R as DesignR

/**
 * Turns catalogue keys into text, once, at the edge.
 *
 * The screens take their strings as a parameter rather than calling
 * `stringResource` themselves — that is what keeps them in modules with no
 * Android dependency and testable without a device. The cost is this file, and
 * it is worth paying.
 */

/**
 * `error.timedOut` → the string behind it.
 *
 * The models emit dotted, camel-cased keys because they are shared with iOS.
 * The lookup goes through the generated [klinikStringIds] rather than
 * `Resources.getIdentifier`: that takes a package name, and a debug build's
 * `applicationIdSuffix` makes the application id differ from the resource
 * package — so every key would resolve to nothing and a tester would read raw
 * keys throughout. A generated map is also compiled, so a key with no string
 * behind it fails the build instead of reaching a screen.
 *
 * The fallback is the key itself: visibly wrong, which is the right failure
 * mode for a key that arrived from somewhere the generator does not see.
 */
fun Context.stringForKey(key: String, fallback: String = key): String {
    val id = klinikStringIds[key] ?: return fallback

    return getString(id)
}

fun Context.stringForRole(role: UserRole): String = stringForKey(role.stringKey, role.name)

@Composable
fun authStrings(errorKey: String?): AuthStrings {
    val context = LocalContext.current

    return AuthStrings(
        signIn = str(DesignR.string.auth_sign_in),
        identifier = str(DesignR.string.auth_identifier),
        password = str(DesignR.string.auth_password),
        twoFactorTitle = str(DesignR.string.auth_two_factor_title),
        twoFactorHint = str(DesignR.string.auth_two_factor_hint),
        twoFactorSetupTitle = str(DesignR.string.auth_two_factor_setup_title),
        twoFactorSetupHint = str(DesignR.string.auth_two_factor_setup_hint),
        done = str(DesignR.string.common_done),
        haveInvitation = str(DesignR.string.auth_have_invitation),
        invitationTitle = str(DesignR.string.auth_invitation_title),
        invitationHint = str(DesignR.string.auth_invitation_hint),
        invitationCode = str(DesignR.string.auth_invitation_code),
        invitationAction = str(DesignR.string.auth_invitation_action),
        choosePassword = str(DesignR.string.auth_choose_password),
        confirmPassword = str(DesignR.string.auth_confirm_password),
        passwordsDiffer = str(DesignR.string.auth_passwords_differ),
        rule = { problem ->
            when (problem) {
                is PasswordRules.Problem.TooShort ->
                    context.getString(DesignR.string.password_rule_length, problem.minimum)

                else -> context.stringForKey(problem.stringKey)
            }
        },
        error = errorKey?.let { context.stringForKey(it) },
    )
}

@Composable
fun homeStrings(displayName: String): HomeStrings {
    val context = LocalContext.current

    return HomeStrings(
        greeting = "${str(DesignR.string.home_title)}, $displayName",
        nextAppointment = str(DesignR.string.home_next_appointment),
        noPatientFile = str(DesignR.string.home_no_patient_file),
        retry = str(DesignR.string.common_retry),
        cancel = str(DesignR.string.common_cancel),
        close = str(DesignR.string.common_close),
        actionTitle = { action -> context.stringForKey(action.titleKey) },
        emergencyConfirmTitle = str(DesignR.string.emergency_confirm_title),
        emergencyConfirmHint = str(DesignR.string.emergency_confirm_hint),
        emergencyConfirmAction = str(DesignR.string.emergency_confirm_action),
        emergencySending = str(DesignR.string.emergency_sending),
        emergencySent = str(DesignR.string.emergency_sent),
        message = { key -> context.stringForKey(key) },
    )
}

@Composable
fun patientStrings(): PatientStrings = PatientStrings(
    searchHint = str(DesignR.string.patient_search_hint),
    empty = str(DesignR.string.patient_empty),
    fileNumber = str(DesignR.string.patient_file_number),
    retry = str(DesignR.string.common_retry),
    loading = str(DesignR.string.common_loading),
    notFound = str(DesignR.string.patient_not_found),
    country = str(DesignR.string.patient_country),
    city = str(DesignR.string.patient_city),
)

@Composable
private fun str(@StringRes id: Int): String = stringResource(id)
