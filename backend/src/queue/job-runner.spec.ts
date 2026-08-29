import { ProcessingStatus } from '@prisma/client';
import { statusAfterFailure } from './job-runner';
import { DEFAULT_JOB_OPTIONS } from './queue.constants';

/**
 * A status that says FAILED while the queue is still going to retry is worse
 * than no status: it sends staff chasing a document that processes itself two
 * minutes later, and it teaches them to ignore the field.
 */
describe('what a failed attempt means for the record', () => {
  it('stays QUEUED while retries remain', () => {
    expect(statusAfterFailure(1, 3)).toBe(ProcessingStatus.QUEUED);
    expect(statusAfterFailure(2, 3)).toBe(ProcessingStatus.QUEUED);
  });

  it('reports FAILED once the attempts are used up', () => {
    expect(statusAfterFailure(3, 3)).toBe(ProcessingStatus.FAILED);
  });

  /** BullMQ can report more attempts than configured after a manual retry. */
  it('reports FAILED beyond the configured limit', () => {
    expect(statusAfterFailure(5, 3)).toBe(ProcessingStatus.FAILED);
  });

  /** A queue configured for a single attempt has no retry to wait for. */
  it('reports FAILED immediately when only one attempt is allowed', () => {
    expect(statusAfterFailure(1, 1)).toBe(ProcessingStatus.FAILED);
  });

  it('matches the configured retry budget', () => {
    const allowed = DEFAULT_JOB_OPTIONS.attempts;

    expect(statusAfterFailure(allowed - 1, allowed)).toBe(ProcessingStatus.QUEUED);
    expect(statusAfterFailure(allowed, allowed)).toBe(ProcessingStatus.FAILED);
  });
});
