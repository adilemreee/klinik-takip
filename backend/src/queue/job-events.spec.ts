import { ProcessingStatus } from '@prisma/client';
import { JOB_EVENTS_CHANNEL, parseJobEvent, publishJobEvent } from './job-events';

const event = {
  jobId: 'j1',
  patientId: 'p1',
  entityType: 'documents',
  entityId: 'd1',
  queue: 'documents',
  name: 'intake',
  status: ProcessingStatus.DONE,
  error: null,
};

/**
 * The bridge between the worker and the API.
 *
 * Everything here is a courtesy on top of a screen that already polls, so the
 * rules are about not making things worse: a publish that fails must not fail
 * the job, and a payload that cannot be trusted must not reach a screen.
 */
describe('job events', () => {
  it('publishes on the channel the API listens to', async () => {
    const redis = { publish: jest.fn().mockResolvedValue(1) };

    await publishJobEvent(redis as never, event);

    expect(redis.publish).toHaveBeenCalledWith(JOB_EVENTS_CHANNEL, JSON.stringify(event));
  });

  /// This runs inside the worker, after the row is already written. Throwing
  /// here would fail a job that has finished successfully.
  it('never throws when Redis refuses', async () => {
    const redis = { publish: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };

    await expect(publishJobEvent(redis as never, event)).resolves.toBeUndefined();
  });

  it('reads back what it wrote', () => {
    expect(parseJobEvent(JSON.stringify(event))).toEqual(event);
  });

  it('refuses anything that is not a job event', () => {
    expect(parseJobEvent('not json')).toBeNull();
    expect(parseJobEvent('{}')).toBeNull();
    expect(parseJobEvent(JSON.stringify({ jobId: 'j1' }))).toBeNull();
  });

  /// An unknown status reaching a screen would colour a row by a state nobody
  /// defined.
  it('refuses a status that is not one of ours', () => {
    expect(parseJobEvent(JSON.stringify({ ...event, status: 'EXPLODED' }))).toBeNull();
  });

  it('fills in what a partial payload leaves out', () => {
    const parsed = parseJobEvent(
      JSON.stringify({ jobId: 'j1', status: ProcessingStatus.QUEUED }),
    );

    expect(parsed).toEqual({
      jobId: 'j1',
      patientId: null,
      entityType: null,
      entityId: null,
      queue: '',
      name: '',
      status: ProcessingStatus.QUEUED,
      error: null,
    });
  });
});
