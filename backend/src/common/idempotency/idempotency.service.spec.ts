import { Test } from '@nestjs/testing';
import { RedisService } from '../../infra/redis.service';
import { IdempotencyService } from './idempotency.service';

/**
 * Enough of Redis to exercise the parts this depends on: SET with NX, GET and
 * DEL. Written out rather than mocked call-by-call because the whole point of
 * `claim` is what happens on the *second* call, which a per-call mock hides.
 */
class FakeRedis {
  entries = new Map<string, string>();
  failing = false;

  set(key: string, value: string, ..._options: unknown[]): Promise<'OK' | null> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));

    const exclusive = _options.includes('NX');

    if (exclusive && this.entries.has(key)) return Promise.resolve(null);

    this.entries.set(key, value);
    return Promise.resolve('OK');
  }

  get(key: string): Promise<string | null> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  del(key: string): Promise<number> {
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(this.entries.delete(key) ? 1 : 0);
  }
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redis: FakeRedis;

  beforeEach(async () => {
    redis = new FakeRedis();

    const moduleRef = await Test.createTestingModule({
      providers: [IdempotencyService, { provide: RedisService, useValue: { client: redis } }],
    }).compile();

    service = moduleRef.get(IdempotencyService);
  });

  const print = (body: unknown): string => service.fingerprint('POST', '/me/measurements', body);

  it('lets the first attempt through', async () => {
    const claim = await service.claim('user-1', 'key-00000001', print({ value: 80 }));

    expect(claim.outcome).toBe('claimed');
  });

  it('holds a second attempt while the first is still running', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);

    const again = await service.claim('user-1', 'key-00000001', fingerprint);

    expect(again.outcome).toBe('in_flight');
  });

  it('replays the first answer instead of doing the work twice', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);
    await service.complete('user-1', 'key-00000001', fingerprint, { id: 'measurement-1' });

    const again = await service.claim('user-1', 'key-00000001', fingerprint);

    expect(again).toEqual({ outcome: 'replay', body: { id: 'measurement-1' } });
  });

  it('refuses a key reused for a different write', async () => {
    await service.claim('user-1', 'key-00000001', print({ value: 80 }));

    const other = await service.claim('user-1', 'key-00000001', print({ value: 95 }));

    expect(other.outcome).toBe('reused');
  });

  it('scopes keys to the user, so nobody is handed somebody else answer', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);
    await service.complete('user-1', 'key-00000001', fingerprint, { id: 'measurement-1' });

    const other = await service.claim('user-2', 'key-00000001', fingerprint);

    expect(other.outcome).toBe('claimed');
  });

  it('frees the key after a failure, so the user can try again', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);
    await service.release('user-1', 'key-00000001');

    const again = await service.claim('user-1', 'key-00000001', fingerprint);

    expect(again.outcome).toBe('claimed');
  });

  it('lets the write through when Redis cannot be reached', async () => {
    redis.failing = true;

    const claim = await service.claim('user-1', 'key-00000001', print({ value: 80 }));

    expect(claim.outcome).toBe('unavailable');
  });

  it('does not remember a response too large to store', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);

    await service.complete('user-1', 'key-00000001', fingerprint, {
      blob: 'x'.repeat(300 * 1024),
    });

    // Nothing stored means the next attempt runs the request rather than being
    // handed a truncated answer.
    const again = await service.claim('user-1', 'key-00000001', fingerprint);
    expect(again.outcome).toBe('claimed');
  });

  it('remembers an answer of null', async () => {
    const fingerprint = print({ value: 80 });
    await service.claim('user-1', 'key-00000001', fingerprint);
    await service.complete('user-1', 'key-00000001', fingerprint, undefined);

    const again = await service.claim('user-1', 'key-00000001', fingerprint);

    expect(again).toEqual({ outcome: 'replay', body: null });
  });

  it('tells two different bodies apart', () => {
    expect(print({ value: 80 })).not.toEqual(print({ value: 81 }));
  });
});
