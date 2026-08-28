import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { DependencyHealthIndicator } from './dependency.health';

// Probes are polled by Docker and the monitoring stack; rate limiting them
// would turn a busy minute into a false "unhealthy" signal.
// Docker and Prometheus poll these without credentials.
@Public()
@SkipThrottle()
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly deps: DependencyHealthIndicator,
  ) {}

  /**
   * Liveness: is the process itself alive? Deliberately checks nothing else —
   * a database outage must not cause the orchestrator to kill healthy pods.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  /** Readiness: can this instance actually serve traffic right now? */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — database, redis and object storage' })
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.deps.checkDatabase(),
      () => this.deps.checkRedis(),
      () => this.deps.checkStorage(),
    ]);
  }
}
