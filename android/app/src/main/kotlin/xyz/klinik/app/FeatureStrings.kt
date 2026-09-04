package xyz.klinik.app

import android.content.Context
import xyz.klinik.feature.complications.ui.ComplicationStrings
import xyz.klinik.feature.documents.ui.DocumentStrings
import xyz.klinik.feature.lab.ui.LabTrendStrings
import xyz.klinik.feature.measurements.ui.RecordStrings
import xyz.klinik.feature.appointments.ui.AppointmentStrings
import xyz.klinik.feature.followup.ui.FollowUpStrings
import xyz.klinik.feature.medications.ui.MedicationStrings
import xyz.klinik.feature.notifications.ui.NotificationStrings
import xyz.klinik.feature.messaging.ui.ChatStrings
import xyz.klinik.feature.photos.ui.PhotoStrings
import xyz.klinik.network.UiText
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
