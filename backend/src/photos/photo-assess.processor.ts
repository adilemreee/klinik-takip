import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { JobHandler } from '../queue/job-runner';
import type { PhotoAssessmentService } from './assessment.service';

/**
 * Assesses a photograph the moment it is uploaded.
 *
 * The assessment used to be something a clinician asked for, one photograph at
 * a time, from the photograph's own screen — so in practice it was asked for
 * about as often as anybody remembered it existed. Running it on arrival is
 * what makes the flagged-photo worklist mean anything: it can only be a
 * worklist if something has looked at the photographs.
 *
 * Every reason not to assess — the switch is off, the AI layer is unavailable,
 * the file is not an image — is already handled inside the service and comes
 * back as a skip rather than a throw, so an unconfigured clinic does not
 * accumulate failed jobs.
 */
export function photoAssess(assessment: PhotoAssessmentService): JobHandler {
  const logger = new Logger('PhotoAssess');

  return async (job: Job): Promise<void> => {
    const { photoId } = job.data as { photoId?: string };

    if (!photoId) throw new Error('Photo assessment job carries no photo id');

    const result = await assessment.assessInBackground(photoId);

    logger.log(
      result.skippedReason === null
        ? `Photo ${photoId} assessed; review ${result.reviewSuggested ? 'suggested' : 'not needed'}`
        : `Photo ${photoId} not assessed (${result.skippedReason})`,
    );
  };
}
