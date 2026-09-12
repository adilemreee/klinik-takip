package xyz.klinik.sync

/**
 * What a queued change is, in words a patient would use.
 *
 * The queue stores an entity type and an encoded body — the right thing to
 * store and the wrong thing to show somebody. "measurements" and a JSON
 * payload tell a patient nothing about whether the thing they are waiting on
 * is their blood pressure or a message to the clinic.
 *
 * Derived here rather than in the screen so it can be held to in a test on a
 * laptop: an entity the app starts queueing later and nobody names would show
 * a reader a table name.
 */
fun OutboxEntry.descriptionKey(): String = when (entityType) {
    "measurements" -> "sync.item.measurement"
    "messages" -> "sync.item.message"
    "complications" -> "sync.item.complication"
    "surveys" -> "sync.item.survey"
    "medication-doses" -> doseKey()
    // Nothing invented: a caller that finds no string behind this shows the
    // entity type as the server spells it, which is honest and visible.
    else -> "sync.item.$entityType"
}

/**
 * A dose check-in says which way it went.
 *
 * "Marked as taken" and "marked as skipped" are different facts about somebody
 * following their treatment, and a queue that showed both as "medication"
 * would hide the one a clinician cares about.
 */
private fun OutboxEntry.doseKey(): String = when {
    "\"skip\"" in payload || "\"SKIPPED\"" in payload -> "sync.item.doseSkipped"
    "\"snooze\"" in payload || "\"SNOOZED\"" in payload -> "sync.item.doseSnoozed"
    else -> "sync.item.doseTaken"
}

/**
 * Whether this change has stopped trying.
 *
 * A stuck entry is not one that is waiting: nothing will move it without a
 * person, and a screen that drew both the same way would have somebody waiting
 * on a queue that has given up.
 */
fun OutboxEntry.isStuck(maxAttempts: Int = 5): Boolean = attempts >= maxAttempts
