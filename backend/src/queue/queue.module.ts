import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Global: queues are infrastructure, and every clinical module eventually hands
 * something heavy to one — OCR, AI analysis, exports, notification fan-out.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
