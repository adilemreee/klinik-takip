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
