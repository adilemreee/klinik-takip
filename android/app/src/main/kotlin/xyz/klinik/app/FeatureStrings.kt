package xyz.klinik.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import xyz.klinik.feature.aisettings.ui.AiSettingsStrings
import xyz.klinik.feature.account.ui.AccountStrings
import xyz.klinik.feature.analytics.ui.AnalyticsStrings
import xyz.klinik.feature.assistant.ui.AssistantStrings
import xyz.klinik.feature.audit.ui.AuditStrings
import xyz.klinik.feature.briefing.ui.BriefingStrings
import xyz.klinik.feature.complications.ui.ComplicationStrings
import xyz.klinik.feature.documents.ui.ChecklistStrings
import xyz.klinik.feature.documents.ui.DocumentStrings
import xyz.klinik.feature.emergency.ui.EmergencyQueueStrings
import xyz.klinik.feature.lab.ui.LabPanelsStrings
import xyz.klinik.feature.lab.ui.LabReviewStrings
import xyz.klinik.feature.lab.ui.LabTrendStrings
import xyz.klinik.feature.measurements.ui.MeasurementStrings
import xyz.klinik.feature.measurements.ui.RecordStrings
import xyz.klinik.feature.appointments.ui.AppointmentStrings
import xyz.klinik.feature.consents.ui.ConsentFormStrings
import xyz.klinik.feature.consents.ui.ConsentStrings
import xyz.klinik.feature.consents.ui.PatientConsentsStrings
import xyz.klinik.feature.exports.ui.ExportsStrings
import xyz.klinik.feature.appointments.ui.AvailabilityStrings
import xyz.klinik.feature.appointments.ui.CalendarStrings
import xyz.klinik.feature.finance.ui.AgencyStrings
import xyz.klinik.feature.finance.ui.FinanceStrings
import xyz.klinik.feature.followup.ui.FollowUpStrings
import xyz.klinik.feature.medications.ui.MedicationStrings
import xyz.klinik.feature.medications.ui.PrescribingStrings
import xyz.klinik.feature.notifications.ui.NotificationStrings
import xyz.klinik.feature.messaging.ui.ChatStrings
import xyz.klinik.feature.messaging.ui.InboxStrings
import xyz.klinik.feature.patients.ui.InviteStrings
import xyz.klinik.feature.patients.ui.NewPatientStrings
import xyz.klinik.feature.photos.ui.FlaggedPhotosStrings
import xyz.klinik.feature.photos.ui.PhotoStrings
import xyz.klinik.feature.protocols.ui.ProtocolsStrings
import xyz.klinik.feature.reports.ui.MyReportsStrings
import xyz.klinik.feature.reports.ui.ReportReviewStrings
import xyz.klinik.feature.surveys.ui.SurveyStrings
import xyz.klinik.feature.surveys.ui.SurveyTrendStrings
import xyz.klinik.feature.sync.ui.PendingChangesStrings
import xyz.klinik.feature.travel.ui.TravelStrings
import xyz.klinik.network.UiText
import xyz.klinik.shell.FileSection
import xyz.klinik.shell.PasswordRules
import xyz.klinik.sync.descriptionKey
import xyz.klinik.shell.StaffDestination
import xyz.klinik.design.R as DesignR

/**
 * The strings each feature screen needs, resolved once at the edge.
 *
 * The screens take their text as a parameter rather than reaching for resources
 * themselves — that is what keeps them in modules with no Android dependency and
 * testable without a device. This file is the cost of that, and it is the right
 * side of the trade.
 *
 * Enum names go through [Context.stringForKey] so a value added to an enum
 * without a string fails the catalogue test rather than showing a raw key.
 */

fun Context.chatStrings(): ChatStrings = ChatStrings(
    compose = getString(DesignR.string.message_compose),
    send = getString(DesignR.string.common_send),
    loadOlder = getString(DesignR.string.message_load_older),
    typing = getString(DesignR.string.message_typing),
    templates = getString(DesignR.string.message_templates),
    attachment = getString(DesignR.string.message_attachment),
    clinicClosed = getString(DesignR.string.message_clinic_closed),
    queuedUntil = getString(DesignR.string.message_queued_until),
    assistantOfferOpen = getString(DesignR.string.assistant_offer_open),
    assistantOfferClosed = getString(DesignR.string.assistant_offer_closed),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    statusName = { status -> stringForKey("message.status.${status.name}") },
    message = { key -> stringForKey(key) },
)

fun Context.documentStrings(): DocumentStrings = DocumentStrings(
    upload = getString(DesignR.string.document_upload),
    empty = getString(DesignR.string.document_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    typeName = { type -> stringForKey("document.type.${type.name}") },
    statusName = { status -> stringForKey("document.status.${status.name}") },
    // Megabytes to one decimal: a clinical scan is measured in MB, and bytes
    // in front of a patient are noise.
    sizeText = { bytes -> String.format("%.1f MB", bytes / 1_048_576.0) },
    message = { key -> stringForKey(key) },
)

fun Context.photoStrings(): PhotoStrings = PhotoStrings(
    empty = getString(DesignR.string.photo_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    compare = getString(DesignR.string.photo_compare),
    compareSlider = getString(DesignR.string.photo_compare_slider),
    before = getString(DesignR.string.photo_before),
    after = getString(DesignR.string.photo_after),
    consentGiven = getString(DesignR.string.photo_consent_given),
    clinicalUseOnly = getString(DesignR.string.photo_clinical_use_only),
    noBodyArea = getString(DesignR.string.complication_no_body_area),
    categoryName = { category -> stringForKey("photo.category.${category.name}") },
    message = { key -> stringForKey(key) },
)

fun Context.complicationStrings(): ComplicationStrings = ComplicationStrings(
    queueEmpty = getString(DesignR.string.complication_queue_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    answer = getString(DesignR.string.complication_answer),
    resolve = getString(DesignR.string.complication_resolve),
    waiting = getString(DesignR.string.complication_waiting),
    respondedIn = getString(DesignR.string.complication_responded_in),
    minutesShort = getString(DesignR.string.common_minutes_short),
    overdueCount = getString(DesignR.string.complication_overdue_count),
    noBodyArea = getString(DesignR.string.complication_no_body_area),
    photoCount = getString(DesignR.string.complication_photo_count),
    answered = getString(DesignR.string.complication_answered),
    awaitingReply = getString(DesignR.string.complication_awaiting_reply),
    reportTitle = getString(DesignR.string.complication_report_title),
    reportHint = getString(DesignR.string.complication_report_hint),
    whatIsWrong = getString(DesignR.string.complication_what_is_wrong),
    bodyArea = getString(DesignR.string.complication_body_area),
    send = getString(DesignR.string.complication_send),
    statusName = { status -> stringForKey("complication.status.${status.name}") },
    message = { key -> stringForKey(key) },
)

fun Context.labTrendStrings(): LabTrendStrings = LabTrendStrings(
    empty = getString(DesignR.string.lab_trend_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    latest = getString(DesignR.string.measurement_latest),
    reference = getString(DesignR.string.lab_trend_reference),
    rangesDiffer = getString(DesignR.string.lab_trend_ranges_differ),
    criticalTitle = getString(DesignR.string.lab_trend_critical_title),
    flagName = { flag -> stringForKey("lab.flag.${flag.name}") },
    message = { key -> stringForKey(key) },
)

/**
 * The body chart, which the staff file and the patient's own screen share.
 *
 * A patient typing a weight every morning and never seeing the curve it makes
 * is a patient filling in somebody else's form, so both sides get the chart
 * rather than only the entry sheet.
 */
fun Context.measurementStrings(): MeasurementStrings = MeasurementStrings(
    weight = getString(DesignR.string.measurement_weight),
    bmi = getString(DesignR.string.measurement_bmi),
    target = getString(DesignR.string.measurement_target),
    latest = getString(DesignR.string.measurement_latest),
    add = getString(DesignR.string.measurement_add),
    empty = getString(DesignR.string.measurement_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    loading = getString(DesignR.string.common_loading),
    categoryName = { category -> stringForKey("bmi.category.${category.name}") },
    message = { key -> stringForKey(key) },
)

/// What OCR read and nobody has confirmed. Staff only — nothing here is
/// clinical until a person says so (spec M16).
fun Context.labReviewStrings(): LabReviewStrings = LabReviewStrings(
    notice = getString(DesignR.string.lab_review_notice),
    empty = getString(DesignR.string.lab_review_empty),
    notFound = getString(DesignR.string.error_not_found),
    retry = getString(DesignR.string.common_retry),
    confirm = getString(DesignR.string.lab_review_confirm),
    correct = getString(DesignR.string.lab_review_correct),
    discard = getString(DesignR.string.lab_review_discard),
    lowConfidence = getString(DesignR.string.lab_review_low_confidence),
    needsMapping = getString(DesignR.string.lab_review_needs_mapping),
    flagName = { flag -> stringForKey("lab.flag.${flag.name}") },
    message = { key -> stringForKey(key) },
)

fun Context.recordStrings(): RecordStrings = RecordStrings(
    title = getString(DesignR.string.measurement_add),
    save = getString(DesignR.string.common_save),
    cancel = getString(DesignR.string.common_cancel),
    note = getString(DesignR.string.measurement_note),
    systolic = getString(DesignR.string.measurement_systolic),
    diastolic = getString(DesignR.string.measurement_diastolic),
    typeName = { type -> stringForKey("measurement.type.${type.name}") },
    message = { key -> stringForKey(key) },
)

fun Context.medicationStrings(): MedicationStrings = MedicationStrings(
    title = getString(DesignR.string.medication_title),
    today = getString(DesignR.string.medication_today),
    empty = getString(DesignR.string.medication_empty),
    notFound = getString(DesignR.string.home_no_patient_file),
    retry = getString(DesignR.string.common_retry),
    adherence = getString(DesignR.string.medication_adherence),
    noScoreYet = getString(DesignR.string.medication_no_score_yet),
    streak = getString(DesignR.string.medication_streak),
    taken = getString(DesignR.string.medication_taken),
    snooze = getString(DesignR.string.medication_snooze),
    skipped = getString(DesignR.string.medication_skipped),
    nextDose = getString(DesignR.string.medication_next_dose),
    awaitingApproval = getString(DesignR.string.medication_awaiting_approval),
    stopped = getString(DesignR.string.medication_stopped),
    statusName = { status -> stringForKey("medication.status.${status.name}") },
    badgeName = { badge -> stringForKey("medication.badge.$badge") },
    message = { key -> stringForKey(key) },
)

fun Context.followUpStrings(): FollowUpStrings = FollowUpStrings(
    empty = getString(DesignR.string.follow_up_empty),
    notFound = getString(DesignR.string.home_no_patient_file),
    retry = getString(DesignR.string.common_retry),
    nextVisit = getString(DesignR.string.follow_up_next_visit),
    missedCount = getString(DesignR.string.follow_up_missed_count),
    markAttended = getString(DesignR.string.follow_up_mark_attended),
    markSkipped = getString(DesignR.string.follow_up_mark_skipped),
    milestoneName = { milestone -> stringForKey("followUp.milestone.${milestone.label}", milestone.label) },
    statusName = { status -> stringForKey("followUp.status.${status.name}") },
    message = { text -> resolve(text) },
)

fun Context.appointmentStrings(): AppointmentStrings = AppointmentStrings(
    empty = getString(DesignR.string.appointment_empty),
    notFound = getString(DesignR.string.home_no_patient_file),
    retry = getString(DesignR.string.common_retry),
    next = getString(DesignR.string.appointment_next),
    awaitingConfirmation = getString(DesignR.string.appointment_awaiting_confirmation),
    confirm = getString(DesignR.string.appointment_confirm),
    cancel = getString(DesignR.string.appointment_cancel),
    typeName = { appointment -> stringForKey("appointment.type.${appointment.type.name}") },
    statusName = { status -> stringForKey("appointment.status.${status.name}") },
    message = { text -> resolve(text) },
)

fun Context.notificationStrings(): NotificationStrings = NotificationStrings(
    title = getString(DesignR.string.notification_settings_title),
    retry = getString(DesignR.string.common_retry),
    fallbackNote = getString(DesignR.string.notification_fallback_note),
    quietHours = getString(DesignR.string.notification_quiet_hours),
    historyTitle = getString(DesignR.string.notification_history_title),
    historyEmpty = getString(DesignR.string.notification_history_empty),
    historyFallback = getString(DesignR.string.notification_history_fallback),
    kindName = { kind -> stringForKey("notification.type.${kind.wire}") },
    channelName = { channel -> stringForKey("notification.channel.${channel.name}") },
    statusName = { status -> stringForKey("notification.status.${status.name}") },
    message = { text -> resolve(text) },
)

/**
 * A [UiText] as text.
 *
 * The server's own wording is used where it sent any — it knows which field was
 * wrong and our catalogue does not.
 */
fun Context.resolve(text: UiText): String = when (text) {
    is UiText.Key -> stringForKey(text.key)
    is UiText.Literal -> text.text
}

fun Context.consentStrings(): ConsentStrings = ConsentStrings(
    noticeTitle = getString(DesignR.string.consent_notice_title),
    noticeBody = getString(DesignR.string.consent_notice_body),
    noticeRead = getString(DesignR.string.consent_notice_read),
    noticeAcknowledged = getString(DesignR.string.consent_notice_acknowledged),
    consentsTitle = getString(DesignR.string.consent_consents_title),
    optionalNote = getString(DesignR.string.consent_optional_note),
    give = getString(DesignR.string.consent_give),
    withdraw = getString(DesignR.string.consent_withdraw),
    given = getString(DesignR.string.consent_given),
    notGiven = getString(DesignR.string.consent_not_given),
    withdrawnAt = getString(DesignR.string.consent_withdrawn_at),
    forwardOnly = getString(DesignR.string.consent_forward_only),
    notFound = getString(DesignR.string.home_no_patient_file),
    retry = getString(DesignR.string.common_retry),
    typeName = { type -> stringForKey(type.stringKey) },
    explanation = { type -> stringForKey(type.explanationKey) },
    message = { key -> stringForKey(key) },
)

/**
 * What each section of a patient's file is called.
 *
 * The neutral names, not the patient's own. The patient's menu says
 * "Ölçümlerim" and "Belgelerim"; a clinician reading somebody else's file is
 * not looking at their own measurements, and the screens these rows open are
 * titled neutrally already.
 */
fun Context.stringForSection(section: FileSection): String = when (section) {
    FileSection.MEASUREMENTS -> getString(DesignR.string.measurement_chart_title)
    FileSection.DOCUMENTS -> getString(DesignR.string.document_title)
    FileSection.LAB_REVIEW -> getString(DesignR.string.lab_review_title)
    FileSection.LAB_TREND -> getString(DesignR.string.lab_trend_title)
    FileSection.PHOTOS -> getString(DesignR.string.menu_photos)
    FileSection.FOLLOW_UP -> getString(DesignR.string.menu_follow_up)
    FileSection.APPOINTMENTS -> getString(DesignR.string.menu_appointments)
    FileSection.CONVERSATION -> getString(DesignR.string.menu_messages)
    FileSection.TRAVEL -> getString(DesignR.string.travel_title)
    FileSection.MEDICATIONS -> getString(DesignR.string.medication_staff_title)
    FileSection.LAB_PANELS -> getString(DesignR.string.lab_staff_title)
    FileSection.CHECKLIST -> getString(DesignR.string.checklist_title)
    FileSection.CONSENTS -> getString(DesignR.string.consent_staff_title)
    FileSection.SURVEYS -> getString(DesignR.string.survey_trend_title)
}

/**
 * What each patient destination is called in the menu.
 *
 * The same words the clinician's file uses where they name the same records:
 * "Tahlil sonuçları" should mean one thing in this product.
 */
fun Context.stringForDestination(destination: PatientDestination): String = when (destination) {
    PatientDestination.Home -> getString(DesignR.string.home_title)
    PatientDestination.Messages -> getString(DesignR.string.menu_messages)
    PatientDestination.Assistant -> getString(DesignR.string.assistant_title)
    PatientDestination.Surveys -> getString(DesignR.string.survey_title)
    PatientDestination.MyReports -> getString(DesignR.string.report_my_reports_title)
    PatientDestination.Travel -> getString(DesignR.string.travel_title)
    PatientDestination.Account -> getString(DesignR.string.account_title)
    PatientDestination.Documents -> getString(DesignR.string.menu_documents)
    PatientDestination.Photos -> getString(DesignR.string.menu_photos)
    PatientDestination.Measurements -> getString(DesignR.string.menu_measurements)
    PatientDestination.Checklist -> getString(DesignR.string.checklist_title)
    PatientDestination.PendingChanges -> getString(DesignR.string.sync_title)
    PatientDestination.LabPanels -> getString(DesignR.string.lab_title)
    PatientDestination.LabResults -> getString(DesignR.string.menu_lab_results)
    PatientDestination.Complications -> getString(DesignR.string.menu_complications)
    PatientDestination.Medications -> getString(DesignR.string.medication_title)
    PatientDestination.FollowUp -> getString(DesignR.string.menu_follow_up)
    PatientDestination.Appointments -> getString(DesignR.string.menu_appointments)
    PatientDestination.NotificationSettings ->
        getString(DesignR.string.notification_settings_title)
    PatientDestination.ConsentForm -> getString(DesignR.string.consent_type_treatment)
    PatientDestination.Consents -> getString(DesignR.string.consent_title)
}

/**
 * The staff emergency queue.
 *
 * Every string already existed in the catalogue — the screen is what was
 * missing, not the words for it.
 */
fun Context.emergencyQueueStrings(): EmergencyQueueStrings = EmergencyQueueStrings(
    title = getString(DesignR.string.emergency_queue_title),
    empty = getString(DesignR.string.emergency_queue_empty),
    retry = getString(DesignR.string.common_retry),
    unanswered = getString(DesignR.string.emergency_unanswered),
    waitingMinutes = { minutes ->
        getString(DesignR.string.emergency_waiting_minutes, minutes)
    },
    acknowledge = getString(DesignR.string.emergency_acknowledge_action),
    resolve = getString(DesignR.string.emergency_resolve_action),
    bloodType = getString(DesignR.string.emergency_summary_blood_type),
    allergies = getString(DesignR.string.emergency_summary_allergies),
    conditions = getString(DesignR.string.emergency_summary_conditions),
    medications = getString(DesignR.string.emergency_summary_medications),
    lastSurgery = getString(DesignR.string.emergency_summary_last_surgery),
    none = getString(DesignR.string.emergency_summary_none),
    call = getString(DesignR.string.emergency_call_action),
    message = { text -> resolve(text) },
)

/**
 * Opens the dialler with a number in it.
 *
 * The dialler, not a call: placing one without the person pressing the green
 * button is an app deciding to ring somebody. `ACTION_DIAL` needs no
 * permission for the same reason.
 */
fun Context.dial(phone: String) {
    val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    // A device with no dialler is a tablet, and crashing on one is worse than
    // a button that does nothing.
    runCatching { startActivity(intent) }
}

/**
 * The clinician's morning.
 *
 * Every string was already in the catalogue — what was missing was the screen,
 * not the words for it.
 */
fun Context.briefingStrings(): BriefingStrings = BriefingStrings(
    title = getString(DesignR.string.briefing_title),
    quiet = getString(DesignR.string.briefing_quiet),
    retry = getString(DesignR.string.common_retry),
    atRisk = getString(DesignR.string.briefing_at_risk),
    yesterday = getString(DesignR.string.briefing_yesterday),
    today = getString(DesignR.string.briefing_today),
    newMessages = getString(DesignR.string.briefing_new_messages),
    urgentMessages = getString(DesignR.string.briefing_urgent_messages),
    emergencies = getString(DesignR.string.briefing_emergencies),
    complications = getString(DesignR.string.briefing_complications),
    criticalLabs = getString(DesignR.string.briefing_critical_labs),
    appointments = getString(DesignR.string.briefing_appointments),
    followUps = getString(DesignR.string.briefing_follow_ups),
    aiSummary = getString(DesignR.string.briefing_ai_summary),
    aiDisclaimer = getString(DesignR.string.briefing_ai_disclaimer),
    riskName = { kind -> stringForKey(kind.stringKey) },
    waitingMinutes = { minutes -> getString(DesignR.string.briefing_waiting_minutes, minutes) },
    waitingHours = { hours -> getString(DesignR.string.briefing_waiting_hours, hours) },
    message = { text -> resolve(text) },
)


/**
 * The sign-off queue every AI interpretation waits in (spec M5).
 *
 * The risk label goes through the catalogue rather than a local `when`, so a
 * risk level added to the API shows the clinic a word instead of a key.
 */
fun Context.reportReviewStrings(): ReportReviewStrings = ReportReviewStrings(
    title = getString(DesignR.string.report_pending_title),
    empty = getString(DesignR.string.report_pending_empty),
    retry = getString(DesignR.string.common_retry),
    doctorView = getString(DesignR.string.report_doctor_view),
    patientView = getString(DesignR.string.report_patient_view),
    noPatientText = getString(DesignR.string.report_no_patient_text),
    releaseAction = getString(DesignR.string.report_release_action),
    holdAction = getString(DesignR.string.report_hold_action),
    generatedAt = getString(DesignR.string.report_generated_at),
    riskName = { level -> stringForKey(level.stringKey) },
    message = { text -> resolve(text) },
)

/**
 * What each clinic-wide screen is called in the staff menu.
 *
 * A `when` rather than a property on the destination: the shell module holds
 * what the routing may say and knows nothing about Android resources, and the
 * compiler still refuses a destination nobody named.
 */
fun Context.stringForStaffDestination(destination: StaffDestination): String = when (destination) {
    StaffDestination.Patients -> getString(DesignR.string.menu_patients)
    StaffDestination.EmergencyQueue -> getString(DesignR.string.menu_emergency_queue)
    StaffDestination.NewPatient -> getString(DesignR.string.patient_new)
    StaffDestination.PendingReports -> getString(DesignR.string.report_pending_title)
    StaffDestination.Analytics -> getString(DesignR.string.analytics_title)
    StaffDestination.Finance -> getString(DesignR.string.finance_title)
    StaffDestination.Agencies -> getString(DesignR.string.agency_title)
    StaffDestination.Calendar -> getString(DesignR.string.calendar_title)
    StaffDestination.Availability -> getString(DesignR.string.availability_title)
    StaffDestination.Exports -> getString(DesignR.string.export_title)
    StaffDestination.AiSettings -> getString(DesignR.string.ai_settings_title)
    StaffDestination.Audit -> getString(DesignR.string.audit_title)
    StaffDestination.Account -> getString(DesignR.string.account_title)
    StaffDestination.PendingChanges -> getString(DesignR.string.sync_title)
    StaffDestination.Protocols -> getString(DesignR.string.protocol_title)
    StaffDestination.ComplicationQueue -> getString(DesignR.string.menu_complication_queue)
    StaffDestination.Inbox -> getString(DesignR.string.inbox_title)
    StaffDestination.FlaggedPhotos -> getString(DesignR.string.photo_flagged_title)
    StaffDestination.NotificationSettings -> getString(DesignR.string.notification_settings_title)
    is StaffDestination.File -> destination.name
    is StaffDestination.Measurements -> stringForSection(FileSection.MEASUREMENTS)
    is StaffDestination.Documents -> stringForSection(FileSection.DOCUMENTS)
    is StaffDestination.LabReview -> stringForSection(FileSection.LAB_REVIEW)
    is StaffDestination.LabTrend -> stringForSection(FileSection.LAB_TREND)
    is StaffDestination.Photos -> stringForSection(FileSection.PHOTOS)
    is StaffDestination.FollowUp -> stringForSection(FileSection.FOLLOW_UP)
    is StaffDestination.Appointments -> stringForSection(FileSection.APPOINTMENTS)
    is StaffDestination.Conversation -> stringForSection(FileSection.CONVERSATION)
    is StaffDestination.Travel -> stringForSection(FileSection.TRAVEL)
    is StaffDestination.Medications -> stringForSection(FileSection.MEDICATIONS)
    is StaffDestination.LabPanels -> stringForSection(FileSection.LAB_PANELS)
    is StaffDestination.Checklist -> stringForSection(FileSection.CHECKLIST)
    is StaffDestination.Consents -> stringForSection(FileSection.CONSENTS)
    is StaffDestination.Surveys -> stringForSection(FileSection.SURVEYS)
    is StaffDestination.Invite -> getString(DesignR.string.invite_title)
}

/**
 * The FAQ assistant (spec M4).
 *
 * `send` is the conversation's own send button rather than a second word for
 * the same action: "Gönder" means one thing in this product.
 */
fun Context.assistantStrings(): AssistantStrings = AssistantStrings(
    title = getString(DesignR.string.assistant_title),
    intro = getString(DesignR.string.assistant_intro),
    placeholder = getString(DesignR.string.assistant_placeholder),
    send = getString(DesignR.string.common_send),
    disclaimer = getString(DesignR.string.assistant_disclaimer),
    handover = getString(DesignR.string.assistant_handover),
    notEnough = getString(DesignR.string.assistant_not_enough),
    sent = getString(DesignR.string.assistant_sent),
    sourcePrefix = getString(DesignR.string.assistant_source_prefix),
    openConversation = getString(DesignR.string.assistant_open_conversation),
    message = { text -> resolve(text) },
)

/**
 * The questionnaires after surgery (spec M18).
 *
 * `{days}` is the catalogue's own placeholder, shared with iOS, and is filled
 * in here rather than by `getString`: the token is not an Android format
 * specifier and the resource has nothing to substitute.
 */
fun Context.surveyStrings(): SurveyStrings = SurveyStrings(
    title = getString(DesignR.string.survey_title),
    nothingPending = getString(DesignR.string.survey_nothing_pending),
    thanks = getString(DesignR.string.survey_thanks),
    closed = getString(DesignR.string.survey_closed),
    submit = getString(DesignR.string.survey_submit),
    retry = getString(DesignR.string.common_retry),
    patientNote = getString(DesignR.string.survey_patient_note),
    textPlaceholder = getString(DesignR.string.survey_text_placeholder),
    yes = getString(DesignR.string.file_yes),
    no = getString(DesignR.string.file_no),
    none = getString(DesignR.string.survey_none),
    best = getString(DesignR.string.survey_best),
    worst = getString(DesignR.string.survey_worst),
    milestone = { days ->
        getString(DesignR.string.survey_milestone).replace("{days}", days.toString())
    },
    message = { text -> resolve(text) },
)

/** The lab interpretations a clinician chose to share with this patient. */
fun Context.myReportsStrings(): MyReportsStrings = MyReportsStrings(
    title = getString(DesignR.string.report_my_reports_title),
    empty = getString(DesignR.string.report_my_reports_empty),
    retry = getString(DesignR.string.common_retry),
    generatedAt = getString(DesignR.string.report_generated_at),
    message = { text -> resolve(text) },
)

/**
 * The clinic's numbers (spec M11).
 *
 * `notice` resolves by catalogue key rather than taking the sentences as
 * fields: the reports name their own caveats, and a caveat added on the server
 * should appear here rather than silently not appearing.
 */
fun Context.analyticsStrings(): AnalyticsStrings = AnalyticsStrings(
    title = getString(DesignR.string.analytics_title),
    notPermitted = getString(DesignR.string.analytics_not_permitted),
    nothingInRange = getString(DesignR.string.analytics_nothing_in_range),
    range = getString(DesignR.string.analytics_range),
    rangeName = { range -> stringForKey(range.stringKey) },
    procedures = getString(DesignR.string.analytics_procedures_title),
    geography = getString(DesignR.string.analytics_geography_title),
    revenue = getString(DesignR.string.analytics_revenue_title),
    channels = getString(DesignR.string.analytics_channels_title),
    occupancy = getString(DesignR.string.analytics_occupancy_title),
    tooFew = getString(DesignR.string.analytics_too_few),
    net = getString(DesignR.string.analytics_net),
    cost = getString(DesignR.string.analytics_cost),
    commission = getString(DesignR.string.analytics_commission),
    margin = getString(DesignR.string.analytics_margin),
    conversion = getString(DesignR.string.analytics_conversion),
    cityUnknown = { count -> getString(DesignR.string.analytics_city_unknown, count) },
    totalOperations = { count -> getString(DesignR.string.analytics_total_operations, count) },
    patientCount = { count -> getString(DesignR.string.analytics_patient_count, count) },
    notice = { key -> stringForKey(key) },
)

/**
 * The clinic's ledger (spec M11).
 *
 * Status and ageing names go through the catalogue rather than a local `when`:
 * a payment status added on the server should show a word here rather than a
 * blank beside somebody's invoice.
 */
fun Context.financeStrings(): FinanceStrings = FinanceStrings(
    title = getString(DesignR.string.finance_title),
    notPermitted = getString(DesignR.string.finance_not_permitted),
    noRecords = getString(DesignR.string.finance_no_records),
    loadMore = getString(DesignR.string.finance_load_more),
    currency = getString(DesignR.string.finance_currency),
    status = getString(DesignR.string.finance_status),
    allStatuses = getString(DesignR.string.finance_all_statuses),
    statusName = { status -> stringForKey(status.stringKey) },
    outstandingTitle = getString(DesignR.string.finance_outstanding_title),
    collectionsTitle = getString(DesignR.string.finance_collections_title),
    ratesTitle = getString(DesignR.string.finance_rates_title),
    ratesNone = getString(DesignR.string.finance_rates_none),
    recordsTitle = getString(DesignR.string.finance_records),
    ageingName = { key -> stringForKey(key) },
    net = getString(DesignR.string.finance_net),
    paid = getString(DesignR.string.finance_paid),
    balance = getString(DesignR.string.finance_balance),
    recordPayment = getString(DesignR.string.finance_record_payment),
    reverse = getString(DesignR.string.finance_reverse),
    recordCount = { count -> getString(DesignR.string.finance_record_count, count) },
    totalsIncomplete = getString(DesignR.string.finance_totals_incomplete),
    message = { text -> resolve(text) },
)

/**
 * Hands a signed link to the browser.
 *
 * Not fetched here: the link is short-lived and signed for this viewer, and a
 * download belongs to the system's download manager rather than to a screen
 * somebody might leave. Asking for it was already recorded in the audit log.
 */
fun Context.openLink(url: String) {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    runCatching { startActivity(intent) }
}

/**
 * Taking data out of the clinic (spec M12).
 *
 * The omission and truncation sentences carry `{count}`, `{matched}` and
 * `{rows}` — the shared catalogue's own placeholders, filled in here because
 * they are not Android format specifiers and the resource has nothing to
 * substitute.
 */
fun Context.exportsStrings(): ExportsStrings = ExportsStrings(
    title = getString(DesignR.string.export_title),
    notPermitted = getString(DesignR.string.export_not_permitted),
    newTitle = getString(DesignR.string.export_new_title),
    history = getString(DesignR.string.export_history),
    noHistory = getString(DesignR.string.export_no_history),
    columns = getString(DesignR.string.export_columns),
    columnUnavailable = getString(DesignR.string.export_column_unavailable),
    chosenCount = { count -> getString(DesignR.string.export_chosen_count, count) },
    format = getString(DesignR.string.export_format),
    formatName = { format -> stringForKey(format.stringKey) },
    country = getString(DesignR.string.export_country),
    request = getString(DesignR.string.export_request),
    download = getString(DesignR.string.export_download),
    expired = getString(DesignR.string.export_expired),
    notAllowed = getString(DesignR.string.export_not_allowed),
    auditNote = getString(DesignR.string.export_audit_note),
    linkShortLived = getString(DesignR.string.export_link_short_lived),
    omitted = getString(DesignR.string.export_omitted),
    statusName = { request -> stringForKey(request.status.stringKey) },
    omission = { key, count -> stringForKey(key).replace("{count}", count.toString()) },
    truncation = { key, matched, rows ->
        stringForKey(key)
            .replace("{matched}", matched.toString())
            .replace("{rows}", rows.toString())
    },
    message = { text -> resolve(text) },
)

/**
 * Which model service the clinic uses (spec 3.4, 14.5).
 *
 * `{last4}` and `{model}` are the shared catalogue's placeholders and are
 * filled in here: they are not Android format specifiers, so `getString` has
 * nothing to substitute.
 */
fun Context.aiSettingsStrings(): AiSettingsStrings = AiSettingsStrings(
    title = getString(DesignR.string.ai_settings_title),
    notPermitted = getString(DesignR.string.ai_not_permitted),
    retry = getString(DesignR.string.common_retry),
    provider = getString(DesignR.string.ai_provider),
    model = getString(DesignR.string.ai_model),
    apiKey = getString(DesignR.string.ai_settings_api_key),
    apiKeyWriteOnly = getString(DesignR.string.ai_settings_api_key_write_only),
    apiKeyStored = { last4 ->
        getString(DesignR.string.ai_settings_api_key_stored).replace("{last4}", last4)
    },
    inputPrice = getString(DesignR.string.ai_input_price),
    outputPrice = getString(DesignR.string.ai_output_price),
    priceHint = getString(DesignR.string.ai_settings_price_hint),
    pricingPage = getString(DesignR.string.ai_pricing_page),
    budget = getString(DesignR.string.ai_settings_budget),
    retention = getString(DesignR.string.ai_retention),
    zeroRetention = getString(DesignR.string.ai_settings_zero_retention),
    zeroRetentionCleared = getString(DesignR.string.ai_settings_zero_retention_cleared),
    retentionNote = getString(DesignR.string.ai_retention_recorded),
    ready = getString(DesignR.string.ai_ready),
    notReady = getString(DesignR.string.ai_not_ready),
    notClinicalReady = getString(DesignR.string.ai_settings_not_clinical_ready),
    save = getString(DesignR.string.common_save),
    test = getString(DesignR.string.ai_settings_test),
    testOk = { model ->
        getString(DesignR.string.ai_settings_test_ok).replace("{model}", model)
    },
    testFailed = getString(DesignR.string.ai_settings_test_failed),
    clear = getString(DesignR.string.ai_settings_clear),
    missingName = { key -> stringForKey(key) },
    message = { text -> resolve(text) },
)

/**
 * Who did what to whose record (spec M13).
 *
 * `entityName` falls back to the server's own spelling: a log that hid a row
 * because the app has no word for its table would have a gap in it, and the
 * gap would be invisible.
 */
fun Context.auditStrings(): AuditStrings = AuditStrings(
    title = getString(DesignR.string.audit_title),
    notPermitted = getString(DesignR.string.audit_not_permitted),
    empty = getString(DesignR.string.audit_empty),
    retry = getString(DesignR.string.common_retry),
    trail = getString(DesignR.string.audit_trail),
    anomalies = getString(DesignR.string.audit_anomalies),
    anomaliesHint = getString(DesignR.string.audit_anomalies_hint),
    anonymous = getString(DesignR.string.audit_anonymous),
    allActions = getString(DesignR.string.audit_all_actions),
    actionName = { action -> stringForKey(action.stringKey) },
    anomalyName = { anomaly -> stringForKey(anomaly.stringKey) },
    roleName = { key -> stringForKey(key) },
    entityName = { entry -> stringForKey(entry.entityKey, entry.entityType) },
    loadMore = getString(DesignR.string.finance_load_more),
    message = { text -> resolve(text) },
)

/** Getting the patient here and home again (spec M14). */
fun Context.travelStrings(): TravelStrings = TravelStrings(
    title = getString(DesignR.string.travel_title),
    noneForPatient = getString(DesignR.string.travel_none),
    emptyForStaff = getString(DesignR.string.travel_empty_staff),
    fillIn = getString(DesignR.string.travel_fill_in),
    retry = getString(DesignR.string.common_retry),
    save = getString(DesignR.string.common_save),
    cancel = getString(DesignR.string.common_cancel),
    flights = getString(DesignR.string.travel_flights),
    arrivalFlight = getString(DesignR.string.travel_arrival_flight),
    arrivalAt = getString(DesignR.string.travel_arrival_at),
    departureFlight = getString(DesignR.string.travel_departure_flight),
    departureAt = getString(DesignR.string.travel_departure_at),
    hotel = getString(DesignR.string.travel_hotel),
    hotelName = getString(DesignR.string.travel_hotel_name),
    hotelAddress = getString(DesignR.string.travel_hotel_address),
    checkIn = getString(DesignR.string.travel_check_in),
    checkOut = getString(DesignR.string.travel_check_out),
    welcome = getString(DesignR.string.travel_welcome),
    greeter = getString(DesignR.string.travel_greeter),
    greeterPhone = getString(DesignR.string.travel_greeter_phone),
    transfer = getString(DesignR.string.travel_transfer),
    interpreter = getString(DesignR.string.travel_interpreter),
    interpreterName = getString(DesignR.string.travel_interpreter_name),
    interpreterLanguage = getString(DesignR.string.travel_interpreter_language),
    interpreterPhone = getString(DesignR.string.travel_interpreter_phone),
    clearanceToggle = getString(DesignR.string.travel_clearance_toggle),
    clearedToFly = getString(DesignR.string.travel_cleared_to_fly),
    notClearedToFly = getString(DesignR.string.travel_not_cleared_to_fly),
    clearedBy = { who, at -> getString(DesignR.string.travel_cleared_by, who, at) },
    message = { text -> resolve(text) },
)

/** What the assistant is allowed to answer from (spec M4). */
fun Context.protocolsStrings(): ProtocolsStrings = ProtocolsStrings(
    title = getString(DesignR.string.protocol_title),
    notPermitted = getString(DesignR.string.protocol_not_permitted),
    empty = getString(DesignR.string.protocol_empty),
    explanation = getString(DesignR.string.protocol_explanation),
    retry = getString(DesignR.string.common_retry),
    add = getString(DesignR.string.protocol_add),
    addHint = getString(DesignR.string.protocol_add_hint),
    documentTitle = getString(DesignR.string.protocol_document_title),
    content = getString(DesignR.string.protocol_content),
    procedureType = getString(DesignR.string.protocol_procedure_type),
    allPatients = getString(DesignR.string.protocol_all_patients),
    usable = getString(DesignR.string.protocol_usable),
    unusable = getString(DesignR.string.protocol_unusable),
    notEmbedded = getString(DesignR.string.protocol_not_embedded),
    retire = getString(DesignR.string.protocol_retire),
    retired = getString(DesignR.string.protocol_retired),
    showRetired = getString(DesignR.string.protocol_show_retired),
    chunks = { count -> getString(DesignR.string.protocol_chunks, count) },
    message = { text -> resolve(text) },
)

/**
 * The account somebody signed in with (spec T7.3).
 *
 * The password rules carry their own number, so the sentence about length says
 * how long rather than being a fixed string that drifts from the policy.
 */
fun Context.accountStrings(): AccountStrings = AccountStrings(
    title = getString(DesignR.string.account_title),
    retry = getString(DesignR.string.common_retry),
    security = getString(DesignR.string.account_security),
    changePassword = getString(DesignR.string.account_change_password),
    changePasswordHint = getString(DesignR.string.account_change_password_hint),
    currentPassword = getString(DesignR.string.account_current_password),
    newPassword = getString(DesignR.string.account_new_password),
    passwordChanged = getString(DesignR.string.account_password_changed),
    twoFactor = getString(DesignR.string.account_two_factor),
    twoFactorOn = getString(DesignR.string.account_two_factor_on),
    twoFactorCode = getString(DesignR.string.account_two_factor_code),
    disableTwoFactor = getString(DesignR.string.account_disable_two_factor),
    disableTwoFactorHint = getString(DesignR.string.account_disable_two_factor_hint),
    twoFactorDisabled = getString(DesignR.string.account_two_factor_disabled),
    twoFactorMandatory = getString(DesignR.string.account_two_factor_mandatory),
    otherDevices = getString(DesignR.string.account_other_devices),
    noOtherDevices = getString(DesignR.string.account_no_other_devices),
    thisDevice = getString(DesignR.string.account_this_device),
    unknownDevice = getString(DesignR.string.account_unknown_device),
    lastSeen = { at -> getString(DesignR.string.account_last_seen, at) },
    revoke = getString(DesignR.string.account_revoke),
    signOutEverywhere = getString(DesignR.string.account_sign_out_everywhere),
    signOutEverywhereConfirm = getString(DesignR.string.account_sign_out_everywhere_confirm),
    dataExport = getString(DesignR.string.data_export_title),
    dataExportHint = getString(DesignR.string.data_export_explain),
    exportRows = { rows -> getString(DesignR.string.data_export_rows, rows) },
    exportOmitted = getString(DesignR.string.data_export_not_included),
    save = getString(DesignR.string.data_export_share),
    rule = { problem ->
        when (problem) {
            is PasswordRules.Problem.TooShort ->
                getString(DesignR.string.password_rule_length, problem.minimum)

            else -> stringForKey(problem.stringKey)
        }
    },
    message = { text -> resolve(text) },
)

/**
 * Hands the portability file to whatever the person wants to keep it in.
 *
 * Shared as text the system can write anywhere rather than downloaded by the
 * app: the file is the patient's, and where it goes is theirs to choose. The
 * bytes are the server's own, unchanged — re-encoding a portability document
 * through this client's model is how a field nobody modelled goes missing.
 */
fun Context.shareDataExport(json: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "application/json"
        putExtra(Intent.EXTRA_TITLE, getString(DesignR.string.data_export_title))
        putExtra(Intent.EXTRA_TEXT, json)
    }

    runCatching {
        startActivity(
            Intent.createChooser(intent, getString(DesignR.string.data_export_share))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/**
 * The clinician's side of the medication module (spec M9).
 *
 * The severity name goes through the catalogue so a level added to the
 * reference shows a word rather than a key beside a drug interaction.
 */
fun Context.prescribingStrings(): PrescribingStrings = PrescribingStrings(
    title = getString(DesignR.string.medication_staff_title),
    empty = getString(DesignR.string.medication_empty_for_patient),
    retry = getString(DesignR.string.common_retry),
    prescribed = getString(DesignR.string.medication_prescribed),
    awaitingApproval = getString(DesignR.string.medication_awaiting_approval),
    stopped = getString(DesignR.string.medication_stopped),
    approve = getString(DesignR.string.medication_approve_action),
    stop = getString(DesignR.string.medication_stop_action),
    nextDose = getString(DesignR.string.medication_next_dose),
    interactionsTitle = getString(DesignR.string.interaction_title),
    interactionDisclaimer = getString(DesignR.string.interaction_disclaimer),
    interactionNone = getString(DesignR.string.interaction_none),
    interactionNotChecked = getString(DesignR.string.interaction_not_checked),
    interactionUnrecognised = getString(DesignR.string.interaction_unrecognised),
    severityName = { severity -> stringForKey(severity.stringKey) },
    newTitle = getString(DesignR.string.prescribe_title),
    drugName = getString(DesignR.string.prescribe_drug_name),
    dose = getString(DesignR.string.prescribe_dose),
    form = getString(DesignR.string.prescribe_form),
    instructions = getString(DesignR.string.prescribe_instructions),
    timesPerDay = getString(DesignR.string.prescribe_times_per_day),
    days = getString(DesignR.string.prescribe_days),
    write = getString(DesignR.string.prescribe_action),
    needName = getString(DesignR.string.prescribe_need_name),
    summary = { times, days, total, hours ->
        getString(DesignR.string.prescribe_summary, times, days, total, hours)
    },
    message = { text -> resolve(text) },
)

/** Confirmed results, as the laboratory printed them (spec M16). */
fun Context.labPanelsStrings(): LabPanelsStrings = LabPanelsStrings(
    title = getString(DesignR.string.lab_title),
    empty = getString(DesignR.string.lab_no_results),
    retry = getString(DesignR.string.common_retry),
    reference = getString(DesignR.string.lab_reference),
    noRange = getString(DesignR.string.lab_no_range),
    openReport = getString(DesignR.string.lab_open_report),
    resultCount = { count -> getString(DesignR.string.lab_result_count, count) },
    abnormalCount = { count -> getString(DesignR.string.lab_abnormal_count, count) },
    flagName = { flag -> stringForKey(flag.stringKey) },
    toggleHint = getString(DesignR.string.lab_toggle_hint),
    expanded = getString(DesignR.string.lab_expanded),
    collapsed = getString(DesignR.string.lab_collapsed),
    message = { text -> resolve(text) },
)

/** What the clinic needs before the operation (spec M17). */
fun Context.checklistStrings(): ChecklistStrings = ChecklistStrings(
    title = getString(DesignR.string.checklist_title),
    explain = getString(DesignR.string.checklist_explain),
    empty = getString(DesignR.string.checklist_empty),
    complete = getString(DesignR.string.checklist_complete),
    retry = getString(DesignR.string.common_retry),
    missing = getString(DesignR.string.checklist_missing),
    optional = getString(DesignR.string.checklist_optional),
    received = getString(DesignR.string.checklist_received),
    upload = getString(DesignR.string.checklist_upload),
    missingCount = { count -> getString(DesignR.string.checklist_missing_count, count) },
    missingOne = getString(DesignR.string.checklist_missing_one),
    message = { text -> resolve(text) },
)

/**
 * What a patient agreed to, read by the clinic (KVKK, spec §8).
 *
 * The type name goes through the catalogue so a consent type added on the
 * server is named rather than showing a key on a legal record.
 */
fun Context.patientConsentsStrings(): PatientConsentsStrings = PatientConsentsStrings(
    title = getString(DesignR.string.consent_staff_title),
    noneRecorded = getString(DesignR.string.consent_none_recorded),
    retry = getString(DesignR.string.common_retry),
    inForce = getString(DesignR.string.consent_given),
    withdrawn = getString(DesignR.string.consent_not_given),
    signedAt = getString(DesignR.string.consent_signed_at),
    version = { version -> getString(DesignR.string.consent_version, version) },
    signature = getString(DesignR.string.consent_signature),
    notSigned = getString(DesignR.string.consent_not_signed),
    forwardOnly = getString(DesignR.string.consent_forward_only),
    typeName = { consent -> stringForKey(consent.type.stringKey) },
    message = { text -> resolve(text) },
)

/**
 * Hands an invitation code to whatever the clinic already uses to reach this
 * person.
 *
 * The app is not the delivery channel: the server returns the code once and
 * keeps only its hash, so it goes out through the coordinator's own SMS or
 * e-mail rather than through a message this app sends on its own.
 */
fun Context.shareInviteCode(code: String, patientName: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, code)
        putExtra(Intent.EXTRA_TITLE, patientName)
    }

    runCatching {
        startActivity(
            Intent.createChooser(intent, getString(DesignR.string.invite_share))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

/** Opening a file (spec M2). */
fun Context.newPatientStrings(): NewPatientStrings = NewPatientStrings(
    title = getString(DesignR.string.patient_new),
    firstName = getString(DesignR.string.patient_first_name),
    lastName = getString(DesignR.string.patient_last_name),
    birthDate = getString(DesignR.string.patient_birth_date),
    sex = getString(DesignR.string.patient_sex),
    sexName = { sex ->
        when (sex) {
            "FEMALE" -> getString(DesignR.string.patient_sex_female)
            "MALE" -> getString(DesignR.string.patient_sex_male)
            else -> getString(DesignR.string.patient_sex_other)
        }
    },
    country = getString(DesignR.string.patient_country_hint),
    city = getString(DesignR.string.patient_city_hint),
    referral = getString(DesignR.string.patient_referral_hint),
    create = getString(DesignR.string.patient_create),
    created = getString(DesignR.string.patient_created),
    fileNumber = getString(DesignR.string.patient_mrn_assigned),
    problem = { problem -> stringForKey(problem.stringKey) },
    message = { text -> resolve(text) },
)

/** Inviting a patient into the app (spec T7.3). */
fun Context.inviteStrings(): InviteStrings = InviteStrings(
    title = getString(DesignR.string.invite_title),
    hint = getString(DesignR.string.invite_hint),
    email = getString(DesignR.string.file_email),
    phone = getString(DesignR.string.file_phone),
    action = getString(DesignR.string.invite_action),
    issued = getString(DesignR.string.invite_issued),
    shownOnce = getString(DesignR.string.invite_shown_once),
    share = getString(DesignR.string.invite_share),
    expires = getString(DesignR.string.invite_expires),
    close = getString(DesignR.string.common_close),
    problem = { problem -> stringForKey(problem.stringKey) },
    message = { text -> resolve(text) },
)

/**
 * When a clinician can be booked (spec M3).
 *
 * The day names come from the platform rather than the catalogue: a weekday is
 * a thing every locale already knows, and shipping seven of them per language
 * is seven more strings to keep in step for no gain.
 */
fun Context.availabilityStrings(): AvailabilityStrings = AvailabilityStrings(
    title = getString(DesignR.string.availability_title),
    explain = getString(DesignR.string.availability_explain),
    retry = getString(DesignR.string.common_retry),
    noneTitle = getString(DesignR.string.availability_none_title),
    noneDetail = getString(DesignR.string.availability_none_detail),
    noProfile = getString(DesignR.string.availability_no_profile),
    day = getString(DesignR.string.availability_day),
    dayName = { day -> weekdayName(day) },
    from = getString(DesignR.string.availability_from),
    to = getString(DesignR.string.availability_to),
    add = getString(DesignR.string.availability_add),
    open = getString(DesignR.string.availability_open),
    paused = getString(DesignR.string.availability_paused),
    withdraw = getString(DesignR.string.availability_withdraw),
    withdrawTitle = getString(DesignR.string.availability_withdraw_title),
    withdrawDetail = getString(DesignR.string.availability_withdraw_detail),
    cancel = getString(DesignR.string.common_cancel),
    message = { text -> resolve(text) },
)

/**
 * A weekday, in the reader's language.
 *
 * The server numbers days from Sunday and `java.time` numbers them from
 * Monday, so the conversion is here rather than in seven call sites.
 */
private fun Context.weekdayName(dayOfWeek: Int): String {
    val locale = resources.configuration.locales[0]
    val day = java.time.DayOfWeek.of(if (dayOfWeek == 0) 7 else dayOfWeek)

    return day.getDisplayName(java.time.format.TextStyle.FULL, locale)
}

/** Who sends the clinic patients, and on what commission (spec M11). */
fun Context.agencyStrings(): AgencyStrings = AgencyStrings(
    title = getString(DesignR.string.agency_title),
    empty = getString(DesignR.string.agency_empty),
    retry = getString(DesignR.string.common_retry),
    add = getString(DesignR.string.agency_add),
    name = getString(DesignR.string.agency_name),
    contact = getString(DesignR.string.agency_contact),
    email = getString(DesignR.string.file_email),
    phone = getString(DesignR.string.file_phone),
    country = getString(DesignR.string.patient_country_hint),
    commission = getString(DesignR.string.agency_commission),
    commissionHint = getString(DesignR.string.agency_commission_hint),
    inactive = getString(DesignR.string.agency_inactive),
    save = getString(DesignR.string.common_save),
    message = { text -> resolve(text) },
)

/** Wound photographs an assessment thought somebody should see (spec M5). */
fun Context.flaggedPhotosStrings(): FlaggedPhotosStrings = FlaggedPhotosStrings(
    title = getString(DesignR.string.photo_flagged_title),
    empty = getString(DesignR.string.photo_none_flagged),
    notPermitted = getString(DesignR.string.photo_not_permitted),
    retry = getString(DesignR.string.common_retry),
    reviewSuggested = getString(DesignR.string.photo_assessment_review_suggested),
    clean = getString(DesignR.string.photo_assessment_clean),
    notAssessed = getString(DesignR.string.photo_assessment_not_assessed),
    disclaimer = getString(DesignR.string.photo_assessment_disclaimer),
    assessAgain = getString(DesignR.string.photo_assess_again),
    openFile = getString(DesignR.string.patient_file_number),
    noBodyArea = getString(DesignR.string.photo_no_body_area),
    findingName = { key -> stringForKey(key) },
    imageLabel = getString(DesignR.string.photo_image),
    message = { text -> resolve(text) },
)

/** The clinic's conversations (spec M6). */
fun Context.inboxStrings(): InboxStrings = InboxStrings(
    title = getString(DesignR.string.inbox_title),
    empty = getString(DesignR.string.inbox_empty),
    notPermitted = getString(DesignR.string.error_forbidden),
    retry = getString(DesignR.string.common_retry),
    waiting = getString(DesignR.string.complication_waiting),
    open = getString(DesignR.string.menu_messages),
    attachment = getString(DesignR.string.message_attachment),
    unreadCount = { count -> getString(DesignR.string.file_unread, count) },
    message = { text -> resolve(text) },
)

/**
 * How a patient's own answers have moved (spec M18).
 *
 * The catalogue's `{days}`, `{answered}` and `{total}` placeholders are filled
 * in here: they are shared with iOS and are not Android format specifiers.
 */
fun Context.surveyTrendStrings(): SurveyTrendStrings = SurveyTrendStrings(
    title = getString(DesignR.string.survey_trend_title),
    noAnswers = getString(DesignR.string.survey_no_answers),
    noTrend = getString(DesignR.string.survey_no_trend),
    retry = getString(DesignR.string.common_retry),
    partial = getString(DesignR.string.survey_partial_short),
    findingName = { finding -> stringForKey(finding.kind.stringKey) },
    milestone = { days ->
        getString(DesignR.string.survey_milestone).replace("{days}", days.toString())
    },
    partialDetail = { answered, total ->
        getString(DesignR.string.survey_partial)
            .replace("{answered}", answered.toString())
            .replace("{total}", total.toString())
    },
    message = { text -> resolve(text) },
)

/** A date a reader can place, in their own locale. */
fun Context.shortDate(millis: Long): String =
    java.text.DateFormat
        .getDateTimeInstance(
            java.text.DateFormat.SHORT,
            java.text.DateFormat.SHORT,
            resources.configuration.locales[0],
        )
        .format(java.util.Date(millis))

/**
 * What has not reached the clinic yet (spec M15).
 *
 * `describe` falls back to the entity type as the server spells it: a change
 * somebody is waiting on must not be a blank row because the app has no word
 * for its table.
 */
fun Context.pendingChangesStrings(): PendingChangesStrings = PendingChangesStrings(
    title = getString(DesignR.string.sync_title),
    empty = getString(DesignR.string.sync_empty),
    emptyDetail = getString(DesignR.string.sync_empty_detail),
    upToDate = getString(DesignR.string.sync_up_to_date),
    sendNow = getString(DesignR.string.sync_send_now),
    sending = getString(DesignR.string.sync_sending),
    waiting = getString(DesignR.string.sync_waiting),
    stuck = getString(DesignR.string.sync_stuck),
    stuckDetail = getString(DesignR.string.sync_stuck_detail),
    discard = getString(DesignR.string.sync_discard),
    discardTitle = getString(DesignR.string.sync_discard_title),
    discardDetail = getString(DesignR.string.sync_discard_detail),
    cancel = getString(DesignR.string.common_cancel),
    conflictTitle = getString(DesignR.string.sync_conflict_title),
    conflictDetail = getString(DesignR.string.sync_conflict_detail),
    keepMine = getString(DesignR.string.sync_keep_mine),
    keepServer = getString(DesignR.string.sync_keep_server),
    urgentWarning = getString(DesignR.string.sync_urgent_warning),
    attempts = { count -> getString(DesignR.string.sync_attempts, count) },
    lastError = { detail -> getString(DesignR.string.sync_last_error, detail) },
    lastSynced = { at -> getString(DesignR.string.sync_last_synced, at) },
    pendingCount = { count -> getString(DesignR.string.sync_pending_count, count) },
    pendingOne = getString(DesignR.string.sync_pending_one),
    describe = { entry -> stringForKey(entry.descriptionKey(), entry.entityType) },
)

/**
 * The clinic's month (spec M3).
 *
 * Month and weekday names come from the platform: every locale already knows
 * them, and shipping nineteen of them per language is nineteen more strings to
 * keep in step for no gain.
 */
fun Context.calendarStrings(): CalendarStrings = CalendarStrings(
    title = getString(DesignR.string.calendar_title),
    notPermitted = getString(DesignR.string.error_forbidden),
    retry = getString(DesignR.string.common_retry),
    previousMonth = getString(DesignR.string.calendar_previous_month),
    nextMonth = getString(DesignR.string.calendar_next_month),
    nothingThatDay = getString(DesignR.string.calendar_nothing_that_day),
    hasRequest = getString(DesignR.string.calendar_has_request),
    appointmentCount = { count -> getString(DesignR.string.calendar_appointment_count, count) },
    minutes = { minutes -> getString(DesignR.string.calendar_minutes, minutes) },
    monthName = { month ->
        val locale = resources.configuration.locales[0]
        "${month.month.getDisplayName(java.time.format.TextStyle.FULL, locale)} ${month.year}"
    },
    weekdayInitial = { day ->
        java.time.DayOfWeek.of(day)
            .getDisplayName(java.time.format.TextStyle.NARROW, resources.configuration.locales[0])
    },
    dayLabel = { date ->
        java.time.format.DateTimeFormatter
            .ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
            .withLocale(resources.configuration.locales[0])
            .format(date)
    },
    typeName = { appointment -> stringForKey(appointment.type.stringKey) },
    statusName = { appointment -> stringForKey(appointment.status.stringKey) },
    message = { text -> resolve(text) },
)

/** Reading and signing the treatment consent (spec §8). */
fun Context.consentFormStrings(): ConsentFormStrings = ConsentFormStrings(
    title = getString(DesignR.string.consent_type_treatment),
    unpublished = getString(DesignR.string.consent_procedure_unknown),
    unpublishedWhy = getString(DesignR.string.consent_procedure_unknown_why),
    retry = getString(DesignR.string.common_retry),
    readToEndFirst = getString(DesignR.string.consent_read_to_end_first),
    signHint = getString(DesignR.string.consent_sign_hint),
    clearSignature = getString(DesignR.string.consent_clear_signature),
    signed = getString(DesignR.string.consent_signed),
    notSigned = getString(DesignR.string.consent_not_signed),
    signatureRequired = getString(DesignR.string.consent_signature_required),
    action = getString(DesignR.string.consent_read_and_sign),
    thanks = getString(DesignR.string.consent_signed_thanks),
    version = { version -> getString(DesignR.string.consent_version, version) },
    message = { text -> resolve(text) },
)
