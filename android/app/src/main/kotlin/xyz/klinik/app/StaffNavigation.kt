package xyz.klinik.app

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.ui.text.input.KeyboardType
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.klinik.design.Tokens
import xyz.klinik.design.klinikColor
import xyz.klinik.feature.account.AccountModel
import xyz.klinik.feature.account.ui.AccountScreen
import xyz.klinik.feature.aisettings.AiSettingsModel
import xyz.klinik.feature.aisettings.ui.AiSettingsScreen
import xyz.klinik.feature.analytics.AnalyticsModel
import xyz.klinik.feature.analytics.ui.AnalyticsScreen
import xyz.klinik.feature.appointments.AppointmentsModel
import xyz.klinik.feature.appointments.AvailabilityModel
import xyz.klinik.feature.appointments.ui.AvailabilityScreen
import xyz.klinik.feature.audit.AuditModel
import xyz.klinik.feature.audit.ui.AuditScreen
import xyz.klinik.feature.appointments.ui.AppointmentsScreen
import xyz.klinik.feature.consents.PatientConsentsModel
import xyz.klinik.feature.consents.ui.PatientConsentsScreen
import xyz.klinik.feature.documents.ChecklistModel
import xyz.klinik.feature.documents.DocumentsModel
import xyz.klinik.feature.complications.ComplicationQueueModel
import xyz.klinik.feature.complications.ui.ComplicationQueueScreen
import xyz.klinik.feature.emergency.EmergencyQueueModel
import xyz.klinik.feature.exports.ExportsModel
import xyz.klinik.feature.exports.ui.ExportsScreen
import xyz.klinik.feature.emergency.ui.EmergencyQueueScreen
import xyz.klinik.feature.documents.ui.ChecklistScreen
import xyz.klinik.feature.documents.ui.DocumentListScreen
import xyz.klinik.feature.finance.AgencyModel
import xyz.klinik.feature.finance.FinanceModel
import xyz.klinik.feature.finance.ui.AgencyScreen
import xyz.klinik.feature.finance.ui.FinanceScreen
import xyz.klinik.feature.followup.FollowUpModel
import xyz.klinik.feature.followup.ui.FollowUpScreen
import xyz.klinik.feature.lab.LabPanelsModel
import xyz.klinik.feature.lab.LabReviewModel
import xyz.klinik.feature.lab.LabTrendModel
import xyz.klinik.feature.lab.ui.LabPanelsScreen
import xyz.klinik.feature.lab.ui.LabReviewScreen
import xyz.klinik.feature.lab.ui.LabTrendScreen
import xyz.klinik.feature.measurements.MeasurementsModel
import xyz.klinik.feature.medications.PrescribingModel
import xyz.klinik.feature.medications.ui.PrescribingScreen
import xyz.klinik.feature.measurements.ui.BodyChartScreen
import xyz.klinik.feature.messaging.ChatModel
import xyz.klinik.feature.messaging.InboxModel
import xyz.klinik.feature.messaging.ui.ChatScreen
import xyz.klinik.feature.messaging.ui.InboxScreen
import xyz.klinik.feature.patients.InviteModel
import xyz.klinik.feature.patients.NewPatientModel
import xyz.klinik.feature.patients.PatientDetailModel
import xyz.klinik.feature.patients.ui.InviteScreen
import xyz.klinik.feature.patients.ui.NewPatientScreen
import xyz.klinik.feature.patients.ui.PatientDetailScreen
import xyz.klinik.feature.photos.FlaggedPhotosModel
import xyz.klinik.feature.photos.PhotoGalleryModel
import xyz.klinik.feature.notifications.NotificationSettingsModel
import xyz.klinik.feature.notifications.ui.NotificationSettingsScreen
import xyz.klinik.feature.photos.ui.FlaggedPhotosScreen
import xyz.klinik.feature.photos.ui.PhotoGalleryScreen
import xyz.klinik.feature.protocols.ProtocolsModel
import xyz.klinik.feature.protocols.ui.ProtocolsScreen
import xyz.klinik.feature.reports.ReportReviewModel
import xyz.klinik.feature.reports.ui.ReportReviewScreen
import xyz.klinik.feature.travel.TravelModel
import xyz.klinik.feature.travel.ui.TravelScreen
import xyz.klinik.network.FinanceRecord
import xyz.klinik.network.MeasurementSource
import xyz.klinik.network.PaymentMethod
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

        StaffDestination.Finance -> {
            val model = remember { FinanceModel(environment.finance) }
            val state by model.state.collectAsStateWithLifecycle()
            var paying by remember { mutableStateOf<FinanceRecord?>(null) }
            var reversing by remember { mutableStateOf<FinanceRecord?>(null) }

            LaunchedEffect(Unit) { model.load() }

            FinanceScreen(
                state = state,
                strings = context.financeStrings(),
                onChooseCurrency = { currency -> scope.launch { model.choose(currency) } },
                onChooseStatus = { status -> scope.launch { model.choose(status) } },
                onLoadMore = { scope.launch { model.loadMore() } },
                onRecordPayment = { record -> paying = record },
                onReverse = { record -> reversing = record },
                modifier = modifier,
            )

            paying?.let { record ->
                PaymentDialog(
                    record = record,
                    onDismiss = { paying = null },
                    onSend = { amount, method, reference ->
                        paying = null
                        scope.launch { model.pay(record.id, amount, method, reference) }
                    },
                )
            }

            reversing?.let { record ->
                // The payment to undo is the newest one that still counts:
                // a reversal names a payment, not a record, and picking the
                // wrong one would correct something nobody asked about.
                val payment = record.livePayments.lastOrNull()

                ReverseDialog(
                    onDismiss = { reversing = null },
                    onSend = { reason ->
                        reversing = null
                        payment?.let { scope.launch { model.reverse(it.id, reason) } }
                    },
                )
            }
        }

        StaffDestination.Exports -> {
            val model = remember { ExportsModel(environment.exports) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            // Only while something is still being produced. A finished export
            // never changes, and a timer that keeps running on a screen of
            // finished files is a battery complaint.
            LaunchedEffect(state.hasUnfinished) {
                while (state.hasUnfinished) {
                    delay(3_000)
                    model.refreshUnfinished()
                }
            }

            ExportsScreen(
                state = state,
                strings = context.exportsStrings(),
                nowIso = nowIso(),
                onToggleColumn = { key -> model.toggle(key) },
                onChooseFormat = { format -> model.choose(format) },
                onRequest = { country ->
                    scope.launch { model.requestPatientList(null, null, country) }
                },
                onDownload = { request ->
                    scope.launch {
                        // Opened in the browser rather than fetched here: the
                        // link is signed for this viewer and short-lived, and
                        // the download belongs to the system, not the app.
                        model.download(request.id)?.let { url -> context.openLink(url) }
                    }
                },
                modifier = modifier,
            )
        }

        StaffDestination.AiSettings -> {
            val model = remember { AiSettingsModel(environment.aiSettings) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AiSettingsScreen(
                state = state,
                strings = context.aiSettingsStrings(),
                onChooseProvider = { provider -> model.choose(provider) },
                onEdit = { change -> model.edit(change) },
                onSave = { scope.launch { model.save() } },
                onTest = { scope.launch { model.test() } },
                onClear = { scope.launch { model.clear() } },
                onOpenPricing = { url -> context.openLink(url) },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Audit -> {
            val model = remember { AuditModel(environment.audit) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AuditScreen(
                state = state,
                strings = context.auditStrings(),
                onChooseAction = { action -> scope.launch { model.choose(action) } },
                onLoadMore = { scope.launch { model.loadMore() } },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Protocols -> {
            val model = remember { ProtocolsModel(environment.protocols) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            ProtocolsScreen(
                state = state,
                strings = context.protocolsStrings(),
                onShowRetired = { show -> model.showRetired(show) },
                onUpload = { title, content, procedure ->
                    scope.launch { model.upload(title, content, procedure) }
                },
                onRetire = { protocol ->
                    scope.launch { model.retire(protocol.document.id) }
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Availability -> {
            val model = remember {
                AvailabilityModel(environment.appointments, java.time.ZoneId.systemDefault().id)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AvailabilityScreen(
                state = state,
                strings = context.availabilityStrings(),
                onAdd = { day, from, to -> scope.launch { model.add(day, from, to) } },
                onSetOpen = { window, open -> scope.launch { model.setOpen(window, open) } },
                onRemove = { window -> scope.launch { model.remove(window) } },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Agencies -> {
            val model = remember { AgencyModel(environment.finance) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AgencyScreen(
                state = state,
                strings = context.agencyStrings(),
                onAdd = { name, country, contact, email, phone, percent ->
                    scope.launch { model.add(name, country, contact, email, phone, percent) }
                },
                onSetActive = { agency, active ->
                    scope.launch { model.setActive(agency, active) }
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Inbox -> {
            val model = remember { InboxModel(environment.messaging) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            InboxScreen(
                state = state,
                strings = context.inboxStrings(),
                // Into the patient's own thread, not a free-standing
                // conversation: everything a clinician needs while replying is
                // in the file the thread belongs to.
                onOpen = { entry ->
                    onOpen(
                        StaffDestination.Conversation(entry.conversation.patientId),
                    )
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.FlaggedPhotos -> {
            val model = remember { FlaggedPhotosModel(environment.photos) }
            val state by model.state.collectAsStateWithLifecycle()
            val imageFor = rememberPhotoImages(
                environment.photos,
                state.photos.map { it.id },
            )

            LaunchedEffect(Unit) { model.load() }

            FlaggedPhotosScreen(
                state = state,
                strings = context.flaggedPhotosStrings(),
                imageFor = imageFor,
                onReassess = { photo -> scope.launch { model.reassess(photo) } },
                // Straight into the file: a worklist that names the patient and
                // cannot open their record is one somebody has to search from.
                onOpenFile = { photo ->
                    onOpen(StaffDestination.File(photo.patientId, photo.patientName))
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.NewPatient -> {
            val model = remember { NewPatientModel(environment.patients) }
            val state by model.state.collectAsStateWithLifecycle()

            NewPatientScreen(
                state = state,
                strings = context.newPatientStrings(),
                onEdit = { change -> model.edit(change) },
                onCreate = { scope.launch { model.create() } },
                // Straight into the record: somebody who has just opened a
                // file is about to put something in it.
                onOpenFile = { patient ->
                    onOpen(StaffDestination.File(patient.id, patient.fullName))
                },
                modifier = modifier,
            )
        }

        is StaffDestination.Invite -> {
            val model = remember(destination.patientId) {
                InviteModel(environment.auth, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            InviteScreen(
                state = state,
                strings = context.inviteStrings(),
                patientName = destination.name,
                onEdit = { email, phone -> model.edit(email, phone) },
                onInvite = { scope.launch { model.invite() } },
                // Handed to whatever the clinic already uses to reach this
                // person; the server keeps only the hash, so the app is not
                // the delivery channel.
                onShare = { code -> context.shareInviteCode(code, destination.name) },
                onDismiss = { model.dismiss() },
                modifier = modifier,
            )
        }

        is StaffDestination.Checklist -> {
            val model = remember(destination.patientId) {
                ChecklistModel(environment.documents, RecordSubject.Patient(destination.patientId))
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            ChecklistScreen(
                state = state,
                strings = context.checklistStrings(),
                // No upload button on the clinician's side: these are the
                // patient's documents to send, and a clinic uploading a
                // passport on somebody's behalf is a different feature with a
                // different consent question behind it.
                onUpload = null,
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        is StaffDestination.Consents -> {
            val model = remember(destination.patientId) {
                PatientConsentsModel(environment.consents, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            PatientConsentsScreen(
                state = state,
                strings = context.patientConsentsStrings(),
                onOpenSignature = { consent ->
                    scope.launch { model.signatureLink(consent)?.let { context.openLink(it) } }
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        is StaffDestination.LabPanels -> {
            val model = remember(destination.patientId) {
                LabPanelsModel(environment.lab, RecordSubject.Patient(destination.patientId))
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            LabPanelsScreen(
                state = state,
                strings = context.labPanelsStrings(),
                onToggle = { panel -> model.toggle(panel) },
                onOpenReport = { panel ->
                    panel.documentId?.let { id ->
                        // A fresh link each time, opened by the system: these
                        // are short-lived and signed for this reader, so the
                        // app never stores one.
                        scope.launch {
                            runCatching { environment.documents.downloadLink(id).url }
                                .getOrNull()
                                ?.let { context.openLink(it) }
                        }
                    }
                },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        is StaffDestination.Medications -> {
            val model = remember(destination.patientId) {
                PrescribingModel(environment.medications, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            PrescribingScreen(
                state = state,
                strings = context.prescribingStrings(),
                onPrescribe = { prescription -> scope.launch { model.prescribe(prescription) } },
                onApprove = { view -> scope.launch { model.approve(view.medication.id) } },
                onStop = { view -> scope.launch { model.stop(view.medication.id) } },
                onRetry = { scope.launch { model.load() } },
                // The device's zone stands in for the patient's until the file
                // carries one: a dose is a wall-clock event, and sending none
                // would have the server pick for us.
                timezone = java.time.ZoneId.systemDefault().id,
                todayIso = nowIso(),
                modifier = modifier,
            )
        }

        is StaffDestination.Travel -> {
            val model = remember(destination.patientId) {
                TravelModel(environment.travel, destination.patientId)
            }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(destination.patientId) { model.load() }

            TravelScreen(
                state = state,
                strings = context.travelStrings(),
                canEdit = true,
                // Offered to everybody who can open a file; the server refuses
                // the ones without the clinical permission and the screen says
                // so. Hiding the switch would leave a doctor unable to find
                // the one control on this screen that is theirs.
                canClearToFly = true,
                onBeginEditing = { model.beginEditing() },
                onCancelEditing = { model.cancelEditing() },
                onEdit = { change -> model.edit(change) },
                onSave = { scope.launch { model.save() } },
                onSetClearedToFly = { on -> scope.launch { model.setClearedToFly(on) } },
                onRetry = { scope.launch { model.load() } },
                modifier = modifier,
            )
        }

        StaffDestination.Account -> {
            val model = remember { AccountModel(environment.auth, environment.me) }
            val state by model.state.collectAsStateWithLifecycle()

            LaunchedEffect(Unit) { model.load() }

            AccountScreen(
                state = state,
                strings = context.accountStrings(),
                onChangePassword = { current, next ->
                    scope.launch { model.changePassword(current, next) }
                },
                onDisableTwoFactor = { code -> scope.launch { model.disableTwoFactor(code) } },
                onEndSession = { session -> scope.launch { model.endSession(session.familyId) } },
                onSignOutEverywhere = { scope.launch { model.signOutEverywhere() } },
                onExport = { scope.launch { model.export() } },
                onSaveExport = { json -> context.shareDataExport(json) },
                onRetry = { scope.launch { model.load() } },
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
                TextButton(
                    onClick = {
                        onOpen(
                            StaffDestination.Invite(destination.patientId, destination.name),
                        )
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = Tokens.minimumTouchTarget),
                ) {
                    Text(
                        text = context.getString(DesignR.string.invite_title),
                        color = klinikColor("accent"),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

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

            // A failed load stays absent rather than becoming a placeholder:
            // a before/after comparison showing the wrong picture, or a grey
            // square read as "nothing here", is worse than a visible gap.
            val imageFor = rememberPhotoImages(
                environment.photos,
                state.groups.flatMap { group -> group.photos.map { it.id } },
            )

            PhotoGalleryScreen(
                state = state,
                strings = context.photoStrings(),
                imageFor = imageFor,
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


/**
 * Money that arrived.
 *
 * The amount is typed rather than defaulted to the balance: a part payment is
 * the ordinary case in this clinic, and a prefilled figure somebody has to
 * clear is a figure somebody will forget to clear.
 */
@Composable
private fun PaymentDialog(
    record: FinanceRecord,
    onDismiss: () -> Unit,
    onSend: (amount: String, method: PaymentMethod, reference: String?) -> Unit,
) {
    val context = LocalContext.current
    var amount by remember { mutableStateOf("") }
    var reference by remember { mutableStateOf("") }
    var method by remember { mutableStateOf(PaymentMethod.BANK_TRANSFER) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(context.getString(DesignR.string.finance_record_payment)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm)) {
                // What is still owed, beside the box, so the number being
                // typed has something to be checked against.
                Text(
                    "${context.getString(DesignR.string.finance_balance)}: " +
                        "${record.currency.symbol}${record.balance}",
                    color = klinikColor("textSecondary"),
                )

                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text(context.getString(DesignR.string.finance_amount)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                )

                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(Tokens.Spacing.sm),
                ) {
                    PaymentMethod.entries.forEach { option ->
                        FilterChip(
                            selected = option == method,
                            onClick = { method = option },
                            label = { Text(context.stringForKey(option.stringKey)) },
                            modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
                        )
                    }
                }

                OutlinedTextField(
                    value = reference,
                    onValueChange = { reference = it },
                    label = { Text(context.getString(DesignR.string.finance_reference)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSend(amount.trim(), method, reference.trim().ifEmpty { null }) },
                enabled = amount.isNotBlank(),
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(context.getString(DesignR.string.common_send))
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(context.getString(DesignR.string.common_cancel))
            }
        },
    )
}

/**
 * Undoing a payment, with the reason it was undone.
 *
 * Required, and the button stays off without one: a ledger that forgets its
 * corrections is a ledger nobody can audit.
 */
@Composable
private fun ReverseDialog(onDismiss: () -> Unit, onSend: (String) -> Unit) {
    val context = LocalContext.current
    var reason by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(context.getString(DesignR.string.finance_reverse)) },
        text = {
            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text(context.getString(DesignR.string.finance_reverse_reason)) },
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { onSend(reason.trim()) },
                enabled = reason.isNotBlank(),
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(context.getString(DesignR.string.common_send))
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.heightIn(min = Tokens.minimumTouchTarget),
            ) {
                Text(context.getString(DesignR.string.common_cancel))
            }
        },
    )
}
