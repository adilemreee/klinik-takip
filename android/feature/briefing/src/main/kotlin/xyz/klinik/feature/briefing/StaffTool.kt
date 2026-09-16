package xyz.klinik.feature.briefing

/**
 * The clinic-wide screens a clinician reaches from the agenda.
 *
 * None of these are new. Every one was already in the app — behind an overflow
 * menu, which is where a feature goes to be forgotten. A doctor who has to
 * open a menu to remember that the clinic has a calendar does not have a
 * calendar.
 *
 * The agenda names them because the agenda is the screen already in front of
 * them, and because a morning screen that says only what is wrong gives a
 * clinician nowhere to go on a morning when nothing is.
 */
enum class StaffTool(val stringKey: String) {
    CALENDAR("menu.calendar"),
    INBOX("menu.inbox"),
    COMPLICATION_QUEUE("menu.complicationQueue"),
    NEW_PATIENT("patient.new"),
    ANALYTICS("menu.analytics"),
    FINANCE("menu.finance"),
    EXPORTS("menu.exports"),
    AVAILABILITY("menu.availability"),
    PROTOCOLS("menu.protocols"),
    AI_SETTINGS("menu.aiSettings"),
    AGENCIES("menu.agencies"),
    AUDIT("menu.audit"),
}
