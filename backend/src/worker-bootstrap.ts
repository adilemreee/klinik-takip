import type { INestApplicationContext } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';

/**
 * Flushes the worker's buffered logs into pino.
 *
 * `bufferLogs: true` holds every line until a logger is attached, so without
 * this the worker runs blind: no startup line, no job failure, nothing at all
 * in `docker logs`. It serves no HTTP, so there is no probe to curl and no
 * request log to fall back on — a queue that had stopped draining would look
 * exactly like a healthy one.
 *
 * Lives here rather than in worker.ts for the same reason configureApp lives
 * outside main.ts: importing an entrypoint runs it.
 */
export function attachWorkerLogging(app: INestApplicationContext): void {
  app.useLogger(app.get(PinoLogger));
}
