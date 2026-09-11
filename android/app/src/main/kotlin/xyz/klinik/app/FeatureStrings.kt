package xyz.klinik.app

import android.content.Context
import android.content.Intent
import android.net.Uri
import xyz.klinik.feature.briefing.ui.BriefingStrings
import xyz.klinik.feature.complications.ui.ComplicationStrings
import xyz.klinik.feature.documents.ui.DocumentStrings
import xyz.klinik.feature.emergency.ui.EmergencyQueueStrings
import xyz.klinik.feature.lab.ui.LabReviewStrings
import xyz.klinik.feature.lab.ui.LabTrendStrings
import xyz.klinik.feature.measurements.ui.MeasurementStrings
import xyz.klinik.feature.measurements.ui.RecordStrings
import xyz.klinik.feature.appointments.ui.AppointmentStrings
import xyz.klinik.feature.consents.ui.ConsentStrings
import xyz.klinik.feature.followup.ui.FollowUpStrings
import xyz.klinik.feature.medications.ui.MedicationStrings
import xyz.klinik.feature.notifications.ui.NotificationStrings
import xyz.klinik.feature.messaging.ui.ChatStrings
import xyz.klinik.feature.photos.ui.PhotoStrings
import xyz.klinik.network.UiText
import xyz.klinik.shell.FileSection
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
 * The same words the patient's own menu uses, because they name the same
 * records — a clinician and a patient looking at "Tahlil sonuçları" should be
 * looking at the same thing.
 */
fun Context.stringForSection(section: FileSection): String = when (section) {
    FileSection.MEASUREMENTS -> getString(DesignR.string.menu_measurements)
    FileSection.DOCUMENTS -> getString(DesignR.string.menu_documents)
    FileSection.LAB_REVIEW -> getString(DesignR.string.lab_review_title)
    FileSection.LAB_TREND -> getString(DesignR.string.lab_trend_title)
    FileSection.PHOTOS -> getString(DesignR.string.menu_photos)
    FileSection.FOLLOW_UP -> getString(DesignR.string.menu_follow_up)
    FileSection.APPOINTMENTS -> getString(DesignR.string.menu_appointments)
    FileSection.CONVERSATION -> getString(DesignR.string.menu_messages)
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
    PatientDestination.Documents -> getString(DesignR.string.menu_documents)
    PatientDestination.Photos -> getString(DesignR.string.menu_photos)
    PatientDestination.Measurements -> getString(DesignR.string.menu_measurements)
    PatientDestination.LabResults -> getString(DesignR.string.menu_lab_results)
    PatientDestination.Complications -> getString(DesignR.string.menu_complications)
    PatientDestination.Medications -> getString(DesignR.string.medication_title)
    PatientDestination.FollowUp -> getString(DesignR.string.menu_follow_up)
    PatientDestination.Appointments -> getString(DesignR.string.menu_appointments)
    PatientDestination.NotificationSettings ->
        getString(DesignR.string.notification_settings_title)
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

