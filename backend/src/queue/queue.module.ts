import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthzModule } from '../authz/authz.module';
import { JobsGateway } from './jobs.gateway';
import { QueueService } from './queue.service';

/**
 * Global: queues are infrastructure, and every clinical module eventually hands
 * something heavy to one — OCR, AI analysis, exports, notification fan-out.
 */
@Global()
@Module({
  // JwtModule for the gateway, which verifies the same access token the REST
  // side does. Registered empty: the secret is passed per call, so the two
  // paths cannot end up trusting different keys.
  imports: [JwtModule.register({}), AuthzModule],
  providers: [QueueService, JobsGateway],
  exports: [QueueService],
})
export class QueueModule {}
