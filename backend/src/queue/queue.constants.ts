/**
 * Queue and job names.
 *
 * Constants rather than strings at the call site: a queue name typed one way in
 * the producer and another in the worker produces jobs nobody ever consumes,
 * and nothing fails — the work simply never happens.
 */
export const QUEUES = {
  documents: 'documents',
  messaging: 'messaging',
  notifications: 'notifications',

  /**
   * Its own queue, for the same reason the notifications queue is: the
   * messaging worker runs one job at a time so a released message goes at the
   * clock time the patient was promised, and an AI call that takes a minute
   * sitting in front of it would break exactly that promise.
   */
  triage: 'triage',

  /**
   * Its own queue because an export is slow and nothing waits on it. A patient
   * summary that takes twenty seconds to render must not sit in front of a
   * document intake that somebody is watching a spinner for.
   */
  exports: 'exports',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  /** Verifies a freshly uploaded document actually landed in storage. */
  documentIntake: 'document-intake',

  /**
   * Releases the parts of uploads nobody came back to. On a bad connection —
   * which is the connection resumable upload exists for — most attempts are
   * abandoned, so without this the bucket grows by every one of them.
   */
  uploadSweep: 'upload-sweep',

  /** Reads a document and files candidate lab values for a human to confirm. */
  documentOcr: 'document-ocr',

  /**
   * Releases messages held until the clinic's access window opens. Without it
   * the queue would hold and never let go: a message written at 3am would stay
   * invisible until someone happened to send another one.
   */
  messageRelease: 'message-release',

  /**
   * Sends notifications that are due, falling back a channel at a time. Its own
   * queue because a backlog of OCR must never delay telling a doctor about a
   * critical value.
   */
  notificationDelivery: 'notification-delivery',

  /**
   * Notifies check-ups that have come due and marks the ones nobody came back
   * for. Hourly is enough: these are dates, not moments.
   */
  followUpSweep: 'follow-up-sweep',

  /** Sends appointment reminders at T-7d, T-1d and T-2h (spec M10). */
  appointmentReminders: 'appointment-reminders',

  /**
   * Climbs the emergency ladder for calls nobody has answered (spec M8). The
   * only job here whose lateness is measured in seconds rather than minutes.
   */
  emergencyEscalation: 'emergency-escalation',

  /**
   * Summarises and triages a patient message (spec M4, M5). Off the request
   * path because the model is slow and the patient is watching a spinner.
   */
  messageTriage: 'message-triage',

  /** Announces the morning briefing at eight, clinic time (spec M5). */
  briefingSweep: 'briefing-sweep',

  /**
   * Dose reminders, renewal reminders and the low-adherence warning (spec M9).
   * One sweep for all three: they read the same rows.
   */
  medicationSweep: 'medication-sweep',

  /** Renders a requested export and stores it (spec M12). */
  exportRender: 'export-render',

  /**
   * Builds next month's audit-log partition before next month (section 13).
   */
  auditPartitionSweep: 'audit-partition-sweep',

  /** Destroying what has outlived its purpose (KVKK m.7). */
  retentionSweep: 'retention-sweep',

  /**
   * Asks the questionnaires that have come due and closes the window on the
   * ones nobody answered (spec M18).
   */
  surveySweep: 'survey-sweep',

  /**
   * Deletes export objects past their expiry.
   *
   * Not housekeeping: a full patient summary sitting in object storage forever
   * is a liability nobody chose to take on. The file is a snapshot somebody
   * asked for once.
   */
  exportSweep: 'export-sweep',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/**
 * Attempts before a job is given up on, with exponential backoff.
 *
 * Three, not more: the failures worth retrying here are transient (storage
 * briefly unavailable), and a job that has failed three times is one a person
 * needs to look at rather than one the queue should keep grinding on.
 */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  /**
   * Completed jobs are dropped from Redis quickly because the durable record is
   * in the `jobs` table. Failed ones are kept longer so an operator can inspect
   * the queue directly while investigating.
   */
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
} as const;
