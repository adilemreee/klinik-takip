package xyz.klinik.app

import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import xyz.klinik.feature.appointments.AppointmentsModel
import xyz.klinik.feature.appointments.ui.AppointmentsScreen
import xyz.klinik.feature.complications.MyComplicationsModel
import xyz.klinik.feature.complications.ui.MyComplicationsScreen
import xyz.klinik.feature.consents.ConsentsModel
import xyz.klinik.feature.consents.ui.ConsentsScreen
import xyz.klinik.feature.documents.DocumentsModel
import xyz.klinik.feature.documents.ui.DocumentListScreen
import xyz.klinik.feature.followup.FollowUpModel
import xyz.klinik.feature.followup.ui.FollowUpScreen
import xyz.klinik.feature.home.HomeAction
import xyz.klinik.feature.lab.LabTrendModel
import xyz.klinik.feature.lab.ui.LabTrendScreen
import xyz.klinik.feature.measurements.MeasurementsModel
import xyz.klinik.feature.measurements.ui.RecordMeasurementScreen
import xyz.klinik.feature.medications.MedicationsModel
import xyz.klinik.feature.medications.ui.MedicationsScreen
import xyz.klinik.feature.messaging.ChatModel
import xyz.klinik.feature.messaging.ui.ChatScreen
import xyz.klinik.feature.notifications.NotificationSettingsModel
import xyz.klinik.feature.notifications.ui.NotificationSettingsScreen
import xyz.klinik.feature.photos.PhotoGalleryModel
import xyz.klinik.feature.photos.ui.PhotoGalleryScreen
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.MeasurementSubject
import xyz.klinik.network.RecordSubject
import xyz.klinik.design.R as DesignR

/**
 * Where a patient can get to (T2.6).
 *
 * A closed set rather than free-form routing, so every reachable screen is
 * listed in one place and a screen nobody can reach fails to compile rather
 * than quietly existing. Mirrors the iOS `PatientDestination`.
 */
sealed interface PatientDestination {
    data object Home : PatientDestination
    data object Messages : PatientDestination
    data object Documents : PatientDestination
    data object Photos : PatientDestination
    data object Measurements : PatientDestination
    data object LabResults : PatientDestination
    data object Complications : PatientDestination
    data object Medications : PatientDestination
    data object FollowUp : PatientDestination
    data object Appointments : PatientDestination
    data object NotificationSettings : PatientDestination
    data object Consents : PatientDestination
}

/**
 * The four home actions that lead somewhere.
 *
 * `EMERGENCY` is the only one that deliberately does not: it arms the two-step
 * confirmation in place, and navigating away would put a screen transition
 * between a patient and the button they just pressed.
 */
fun destinationFor(action: HomeAction): PatientDestination? = when (action) {
    HomeAction.MESSAGES -> PatientDestination.Messages
    HomeAction.UPLOAD_DOCUMENT -> PatientDestination.Documents
    HomeAction.ADD_PHOTO -> PatientDestination.Photos
    HomeAction.MEDICATIONS -> PatientDestination.Medications
    HomeAction.EMERGENCY -> null
}

/**
 * The patient's screens, reached from the home screen and its overflow menu.
 *
 * Every model here is built with `RecordSubject.Me`. Not a shortcut: a patient
 * holds `self.read`, not `documents.read`, so the staff path answers 403 for
 * their own records.
 */
@Composable
fun PatientDestinationScreen(
    environment: AppEnvironment,
    destination: PatientDestination,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    when (destination) {
        PatientDestination.Home -> Unit

        PatientDestination.Messages -> {
            val model = remember {
                // A patient has one conversation with the clinic and the server
                // decides which; asking for it by id would let the client name
                // somebody else's.
                ChatModel(environment.messaging) { environment.messaging.myConversation() }
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            ChatScreen(
                state = state,
                strings = context.chatStrings(),
                canUseTemplates = false,
                onRetry = { scope.launch { model.load() } },
                onSend = { text -> scope.launch { model.send(text) } },
                onLoadOlder = { scope.launch { model.loadOlder() } },
                onTyping = {},
                onPickTemplate = {},
                modifier = modifier,
            )
        }

        PatientDestination.Documents -> {
            val model = remember {
                DocumentsModel(environment.documents, environment.resumable, RecordSubject.Me)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            DocumentListScreen(
                state = state,
                strings = context.documentStrings(),
                canUpload = true,
                onRetry = { scope.launch { model.load() } },
                // The picker is device work that arrives with the camera and
                // file layers; the button is present and does nothing rather
                // than absent, so the gap is visible.
                onUpload = {},
                onLoadMore = { scope.launch { model.loadMore() } },
                modifier = modifier,
            )
        }

        PatientDestination.Photos -> {
            val model = remember { PhotoGalleryModel(environment.photos, RecordSubject.Me) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            PhotoGalleryScreen(
                state = state,
                strings = context.photoStrings(),
                // Nil rather than a placeholder: a before/after comparison
                // showing the wrong picture is worse than showing none.
                imageFor = { null },
                onRetry = { scope.launch { model.load() } },
                onSelectArea = model::select,
                // Comparison is its own screen; reaching it is the next slice.
                onCompare = {},
                modifier = modifier,
            )
        }

        PatientDestination.Measurements -> {
            val model = remember {
                MeasurementsModel(
                    environment.measurements,
                    MeasurementSubject.Mine,
                    // A reading a patient types is recorded as theirs. Sending
                    // NURSE from a patient build would put an unverified number
                    // into a clinical record wearing a nurse's authority.
                    MeasurementSource.PATIENT,
                )
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            RecordMeasurementScreen(
                state = state,
                strings = context.recordStrings(),
                onSave = { reading -> scope.launch { model.record(reading) } },
                onCancel = {},
                modifier = modifier,
            )
        }

        PatientDestination.LabResults -> {
            val model = remember { LabTrendModel(environment.lab, RecordSubject.Me) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            LabTrendScreen(
                state = state,
                strings = context.labTrendStrings(),
                onRetry = { scope.launch { model.load() } },
                onSelect = model::select,
                modifier = modifier,
            )
        }

        PatientDestination.Medications -> {
            val model = remember { MedicationsModel(environment.medications) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            MedicationsScreen(
                state = state,
                strings = context.medicationStrings(),
                onRetry = { scope.launch { model.load() } },
                onCheckIn = { logId, action, minutes ->
                    scope.launch { model.checkIn(logId, action, minutes) }
                },
                modifier = modifier,
            )
        }

        PatientDestination.FollowUp -> {
            val model = remember { FollowUpModel(environment.followUp) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.refresh() }

            FollowUpScreen(
                state = state,
                strings = context.followUpStrings(),
                // A patient reads the calendar; staff mark a visit attended.
                canMark = false,
                nowIso = nowIso(),
                onRetry = { scope.launch { model.refresh() } },
                onMark = { _, _ -> },
                modifier = modifier,
            )
        }

        PatientDestination.Appointments -> {
            val model = remember { AppointmentsModel(environment.appointments) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.refresh() }

            AppointmentsScreen(
                state = state,
                strings = context.appointmentStrings(),
                canConfirm = false,
                nowIso = nowIso(),
                onRetry = { scope.launch { model.refresh() } },
                onConfirm = {},
                onCancel = { id -> scope.launch { model.cancel(id) } },
                modifier = modifier,
            )
        }

        PatientDestination.Consents -> {
            val model = remember { ConsentsModel(environment.consents) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            ConsentsScreen(
                state = state,
                strings = context.consentStrings(),
                onRetry = { scope.launch { model.load() } },
                onOpenNotice = {
                    context.startActivity(
                        Intent(Intent.ACTION_VIEW, environment.privacyNoticeUrl.toUri()),
                    )
                },
                onChange = { type, give ->
                    scope.launch { if (give) model.give(type) else model.withdraw(type) }
                },
                modifier = modifier,
            )
        }

        PatientDestination.NotificationSettings -> {
            val model = remember { NotificationSettingsModel(environment.notifications) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            NotificationSettingsScreen(
                state = state,
                strings = context.notificationStrings(),
                onRetry = { scope.launch { model.load() } },
                onToggle = { kind, channel, on ->
                    scope.launch { model.set(kind, channel, on) }
                },
                modifier = modifier,
            )
        }

        PatientDestination.Complications -> {
            val model = remember { MyComplicationsModel(environment.complications) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            MyComplicationsScreen(
                state = state,
                strings = context.complicationStrings(),
                onReport = { note, area -> scope.launch { model.report(note, area) } },
                modifier = modifier,
            )
        }
    }
}

/** The overflow menu: everything that is not one of the five home actions. */
@Composable
fun PatientOverflowMenu(onGo: (PatientDestination) -> Unit, onSignOut: () -> Unit) {
    var open by remember { mutableStateOf(false) }

    Column {
        TextButton(onClick = { open = true }) {
            Text(stringResource(DesignR.string.common_more))
        }

        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            val items = listOf(
                DesignR.string.menu_measurements to PatientDestination.Measurements,
                DesignR.string.menu_follow_up to PatientDestination.FollowUp,
                DesignR.string.menu_appointments to PatientDestination.Appointments,
                DesignR.string.menu_lab_results to PatientDestination.LabResults,
                DesignR.string.menu_complications to PatientDestination.Complications,
                DesignR.string.menu_photos to PatientDestination.Photos,
                DesignR.string.consent_title to PatientDestination.Consents,
                DesignR.string.notification_settings_title to PatientDestination.NotificationSettings,
            )

            for ((label, destination) in items) {
                DropdownMenuItem(
                    text = { Text(stringResource(label)) },
                    onClick = {
                        open = false
                        onGo(destination)
                    },
                )
            }

            DropdownMenuItem(
                text = { Text(stringResource(DesignR.string.auth_sign_out)) },
                onClick = {
                    open = false
                    onSignOut()
                },
            )
        }
    }
}

/**
 * Now, as ISO-8601.
 *
 * Read here rather than inside a screen: a screen that reads the clock cannot
 * be tested at the boundary that matters — which visit counts as next.
 */
private fun nowIso(): String = java.time.Instant.now().toString()
