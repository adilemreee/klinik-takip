package xyz.klinik.app

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.analytics.AnalyticsModel
import xyz.klinik.feature.analytics.ui.AnalyticsScreen
import xyz.klinik.feature.appointments.AppointmentsModel
import xyz.klinik.feature.appointments.ui.AppointmentsScreen
import xyz.klinik.feature.documents.DocumentsModel
import xyz.klinik.feature.complications.ComplicationQueueModel
import xyz.klinik.feature.complications.ui.ComplicationQueueScreen
import xyz.klinik.feature.emergency.EmergencyQueueModel
import xyz.klinik.feature.emergency.ui.EmergencyQueueScreen
import xyz.klinik.feature.documents.ui.DocumentListScreen
import xyz.klinik.feature.followup.FollowUpModel
import xyz.klinik.feature.followup.ui.FollowUpScreen
import xyz.klinik.feature.lab.LabReviewModel
import xyz.klinik.feature.lab.LabTrendModel
import xyz.klinik.feature.lab.ui.LabReviewScreen
import xyz.klinik.feature.lab.ui.LabTrendScreen
import xyz.klinik.feature.measurements.MeasurementsModel
import xyz.klinik.feature.measurements.ui.BodyChartScreen
import xyz.klinik.feature.messaging.ChatModel
import xyz.klinik.feature.messaging.ui.ChatScreen
import xyz.klinik.feature.patients.PatientDetailModel
import xyz.klinik.feature.patients.ui.PatientDetailScreen
import xyz.klinik.feature.photos.PhotoGalleryModel
import xyz.klinik.feature.notifications.NotificationSettingsModel
import xyz.klinik.feature.notifications.ui.NotificationSettingsScreen
import xyz.klinik.feature.photos.ui.PhotoGalleryScreen
import xyz.klinik.feature.reports.ReportReviewModel
import xyz.klinik.feature.reports.ui.ReportReviewScreen
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.MeasurementSubject
import xyz.klinik.network.RecordSubject
import xyz.klinik.shell.FileSection
import xyz.klinik.shell.StaffDestination
import xyz.klinik.shell.destinationFor
import xyz.klinik.design.R as DesignR

/**
 * One staff screen.
 *
 * Every model is built with the patient's id rather than `Me`: a clinician
 * reading somebody's file holds `documents.read`, and the `me/…` path would
 * answer with their own records — which for a doctor is nothing at all.
 */
@Composable
fun StaffDestinationScreen(
    environment: AppEnvironment,
    destination: StaffDestination,
    onOpen: (StaffDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    when (destination) {
        StaffDestination.Patients -> Unit

        StaffDestination.EmergencyQueue -> {
            val model = remember { EmergencyQueueModel(environment.emergency) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.refresh() }

            EmergencyQueueScreen(
                state = state,
                strings = context.emergencyQueueStrings(),
                onRetry = { scope.launch { model.refresh() } },
                onAcknowledge = { id -> scope.launch { model.acknowledge(id) } },
                // Closing a call needs a sentence saying what happened; the
                // form for it is the next slice. Acknowledging — which is the
                // one with a clock on it — works now.
                onResolve = {},
                onCall = { phone -> context.dial(phone) },
                modifier = modifier,
            )
        }

        StaffDestination.PendingReports -> {
            val model = remember { ReportReviewModel(environment.reports) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.refresh() }

            ReportReviewScreen(
                state = state,
                strings = context.reportReviewStrings(),
                onRetry = { scope.launch { model.refresh() } },
                onReview = { id, release -> scope.launch { model.review(id, release) } },
                modifier = modifier,
            )
        }

        StaffDestination.ComplicationQueue -> {
            val model = remember { ComplicationQueueModel(environment.complications) }
            val state by model.state.collectAsStateWithLifecycle()
            // Answering and closing both need a sentence from the clinician,
            // so the row opens a box for one rather than sending an empty
            // reply the patient would read as being ignored.
            var replying by remember { mutableStateOf<ComplicationReply?>(null) }

            LaunchedEffect(Unit) { model.load() }

            ComplicationQueueScreen(
                state = state,
                strings = context.complicationStrings(),
                onRetry = { scope.launch { model.load() } },
                onAnswer = { view ->
                    replying = ComplicationReply(view.complication.id, resolve = false)
                },
                onResolve = { view ->
                    replying = ComplicationReply(view.complication.id, resolve = true)
                },
                modifier = modifier,
            )

            replying?.let { reply ->
                ComplicationReplyDialog(
                    resolve = reply.resolve,
                    onDismiss = { replying = null },
                    onSend = { message ->
                        replying = null
                        scope.launch {
                            if (reply.resolve) {
                                model.resolve(reply.id, message)
                            } else {
                                model.acknowledge(reply.id, message)
                            }
                        }
                    },
                )
            }
        }

        StaffDestination.Analytics -> {
            val model = remember { AnalyticsModel(environment.analytics) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AnalyticsScreen(
                state = state,
                strings = context.analyticsStrings(),
                onChooseRange = { range -> scope.launch { model.choose(range) } },
                onChooseCurrency = { currency -> scope.launch { model.choose(currency) } },
                modifier = modifier,
            )
        }

        StaffDestination.NotificationSettings -> {
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

        is StaffDestination.File -> {
            val model = remember(destination.patientId) {
                PatientDetailModel(environment.patients, destination.patientId)
            }
            val phase by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            PatientDetailScreen(
                phase = phase,
                strings = patientStrings(),
                onRetry = { scope.launch { model.load() } },
            ) {
                // The rest of the file. Buttons rather than a menu: a
                // clinician opening a record is looking for one of these, and
                // hiding them behind an overflow is one tap to find out what
                // the app can even do.
                FileSection.entries.forEach { section ->
                    TextButton(
                        onClick = { onOpen(destinationFor(section, destination.patientId)) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = Tokens.minimumTouchTarget),
                    ) {
                        Text(
                            text = context.stringForSection(section),
                            color = klinikColor("accent"),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        }

        is StaffDestination.Measurements -> {
            val model = remember(destination.patientId) {
                MeasurementsModel(
                    environment.measurements,
                    MeasurementSubject.OfPatient(destination.patientId),
                    // A reading a clinician enters is a clinician's. The server
                    // refuses this field on the patient's own path, which is
                    // why the two are separate models rather than a flag.
                    MeasurementSource.NURSE,
                )
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            BodyChartScreen(
                state = state,
                strings = context.measurementStrings(),
                canRecord = true,
                onRetry = { scope.launch { model.load() } },
                onAdd = { /* The entry sheet arrives with the staff form. */ },
                modifier = modifier,
            )
        }

        is StaffDestination.Documents -> {
            val model = remember(destination.patientId) {
                DocumentsModel(
                    environment.documents,
                    environment.resumable,
                    RecordSubject.Patient(destination.patientId),
                )
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            DocumentListScreen(
                state = state,
                strings = context.documentStrings(),
                // Reading, not uploading: a clinician looking at a file is not
                // the person who sends the passport.
                canUpload = false,
                onRetry = { scope.launch { model.load() } },
                onUpload = {},
                onLoadMore = { scope.launch { model.loadMore() } },
                modifier = modifier,
            )
        }

        is StaffDestination.LabReview -> {
            val model = remember(destination.patientId) {
                LabReviewModel(environment.lab, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            LabReviewScreen(
                state = state,
                strings = context.labReviewStrings(),
                onRetry = { scope.launch { model.load() } },
                onConfirm = { id -> scope.launch { model.confirm(id) } },
                // Correcting a value opens a form the staff build does not have
                // yet; confirming and discarding are the two that work.
                onCorrect = {},
                onDiscard = { id -> scope.launch { model.discard(id) } },
                modifier = modifier,
            )
        }

        is StaffDestination.LabTrend -> {
            val model = remember(destination.patientId) {
                LabTrendModel(environment.lab, RecordSubject.Patient(destination.patientId))
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            LabTrendScreen(
                state = state,
                strings = context.labTrendStrings(),
                onRetry = { scope.launch { model.load() } },
                onSelect = { id -> model.select(id) },
                modifier = modifier,
            )
        }

        is StaffDestination.Photos -> {
            val model = remember(destination.patientId) {
                PhotoGalleryModel(environment.photos, RecordSubject.Patient(destination.patientId))
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            PhotoGalleryScreen(
                state = state,
                strings = context.photoStrings(),
                // Nil rather than a placeholder: a before/after comparison
                // showing the wrong picture is worse than showing none.
                imageFor = { null },
                onRetry = { scope.launch { model.load() } },
                onSelectArea = model::select,
                onCompare = {},
                modifier = modifier,
            )
        }

        is StaffDestination.FollowUp -> {
            val model = remember(destination.patientId) {
                FollowUpModel(environment.followUp, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.refresh() }

            FollowUpScreen(
                state = state,
                strings = context.followUpStrings(),
                // A clinician marks a visit attended; a patient only reads.
                canMark = true,
                nowIso = nowIso(),
                onRetry = { scope.launch { model.refresh() } },
                onMark = { id, status -> scope.launch { model.mark(id, status) } },
                modifier = modifier,
            )
        }

        is StaffDestination.Appointments -> {
            val model = remember(destination.patientId) {
                AppointmentsModel(environment.appointments, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.refresh() }

            AppointmentsScreen(
                state = state,
                strings = context.appointmentStrings(),
                canConfirm = true,
                nowIso = nowIso(),
                onRetry = { scope.launch { model.refresh() } },
                onConfirm = { id -> scope.launch { model.confirm(id) } },
                onCancel = { id -> scope.launch { model.cancel(id) } },
                modifier = modifier,
            )
        }

        is StaffDestination.Conversation -> {
            val model = remember(destination.patientId) {
                // Named by the caller here, unlike the patient's own thread:
                // staff read a conversation that belongs to a file they can
                // reach, and the server checks that rather than trusting it.
                ChatModel(environment.messaging) {
                    environment.messaging.conversation(destination.patientId)
                }
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            ChatScreen(
                state = state,
                strings = context.chatStrings(),
                // The clinic's saved replies, which a patient has no use for.
                canUseTemplates = true,
                onRetry = { scope.launch { model.load() } },
                onSend = { text -> scope.launch { model.send(text) } },
                onLoadOlder = { scope.launch { model.loadOlder() } },
                onTyping = {},
                onPickTemplate = {},
                modifier = modifier,
            )
        }
    }
}


/** Which complication a clinician is writing back about, and whether it closes it. */
private data class ComplicationReply(val id: String, val resolve: Boolean)

/**
 * The sentence that goes back to the patient.
 *
 * Required rather than optional: a complication marked answered with nothing
 * written reads, on the patient's screen, as having been dismissed.
 */
@Composable
private fun ComplicationReplyDialog(
    resolve: Boolean,
    onDismiss: () -> Unit,
    onSend: (String) -> Unit,
) {
    var message by remember { mutableStateOf("") }
    val context = LocalContext.current

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (resolve) {
                    context.getString(DesignR.string.complication_resolve)
                } else {
                    context.getString(DesignR.string.complication_answer)
                },
            )
        },
        text = {
            OutlinedTextField(
                value = message,
                onValueChange = { message = it },
                label = { Text(context.getString(DesignR.string.complication_your_answer)) },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSend(message.trim()) },
                enabled = message.isNotBlank(),
            ) {
                Text(context.getString(DesignR.string.common_send))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(context.getString(DesignR.string.common_cancel))
            }
        },
    )
}
