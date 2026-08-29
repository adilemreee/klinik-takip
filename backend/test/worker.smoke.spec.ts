import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma.service';
import { RedisService } from '../src/infra/redis.service';
import { StorageService } from '../src/infra/storage.service';
import { attachWorkerLogging } from '../src/worker-bootstrap';

/**
 * The worker's logs are the only window into it.
 *
 * It serves no HTTP, so there is no probe to curl and no request log to read.
 * It booted for a while emitting nothing at all: `bufferLogs: true` holds every
 * line until a logger is attached, and nothing attached one. A queue that had
 * stopped draining would have looked exactly like a healthy one.
 *
 * The assertion is on the wiring rather than on captured output, because pino
 * writes to its own destination rather than through process.stdout — but it is
 * the wiring that was missing, and removing the call fails this test.
 */
describe('Worker smoke test', () => {
  it('attaches a real logger to the buffered context', async () => {
    const healthy = (): { ping: jest.Mock } => ({
      ping: jest.fn().mockResolvedValue(undefined),
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ ...healthy(), $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(RedisService)
      .useValue(healthy())
      .overrideProvider(StorageService)
      .useValue(healthy())
      .compile();

    const app = await moduleRef.createNestApplication().init();
    const useLogger = jest.spyOn(app, 'useLogger');

    try {
      attachWorkerLogging(app);
    } finally {
      await app.close();
    }

    expect(useLogger).toHaveBeenCalledTimes(1);
    // Resolving it is half the point: an unexported provider would crash the
    // worker on start rather than merely silence it.
    expect(useLogger.mock.calls[0]![0]).toBeInstanceOf(PinoLogger);
  });
});
