import { BadRequestException, CallHandler, ConflictException, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { ClaimResult, IdempotencyService } from './idempotency.service';

describe('IdempotencyInterceptor', () => {
  let claim: jest.Mock<Promise<ClaimResult>, [string, string, string]>;
  let complete: jest.Mock;
  let release: jest.Mock;
  let interceptor: IdempotencyInterceptor;
  let headers: Record<string, string>;

  const context = (options: {
    method?: string;
    key?: string;
    userId?: string | undefined;
  } = {}): ExecutionContext => {
    const request = {
      method: options.method ?? 'POST',
      headers: options.key === undefined ? {} : { 'idempotency-key': options.key },
      route: { path: '/me/measurements' },
      originalUrl: '/me/measurements',
      url: '/me/measurements',
      body: { value: 80 },
      user: 'userId' in options && options.userId === undefined
        ? undefined
        : { id: options.userId ?? 'user-1', role: 'PATIENT', familyId: 'family-1' },
    };

    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext;
  };

  const handler = (value: unknown): CallHandler => ({ handle: () => of(value) });

  beforeEach(() => {
    headers = {};
    claim = jest.fn<Promise<ClaimResult>, [string, string, string]>();
    complete = jest.fn().mockResolvedValue(undefined);
    release = jest.fn().mockResolvedValue(undefined);

    interceptor = new IdempotencyInterceptor({
      fingerprint: () => 'fingerprint',
      claim,
      complete,
      release,
    } as unknown as IdempotencyService);
  });

  it('leaves a request without a key alone', async () => {
    const result = await firstValueFrom(interceptor.intercept(context({ key: undefined }), handler('ran')));

    expect(result).toBe('ran');
    expect(claim).not.toHaveBeenCalled();
  });

  it('leaves reads alone even when they carry a key', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context({ method: 'GET', key: 'key-00000001' }), handler('ran')),
    );

    expect(result).toBe('ran');
    expect(claim).not.toHaveBeenCalled();
  });

  it('refuses a malformed key rather than treating it as absent', () => {
    expect(() => interceptor.intercept(context({ key: 'short' }), handler('ran'))).toThrow(
      BadRequestException,
    );
  });

  it('skips the check on a route with no authenticated user', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(context({ key: 'key-00000001', userId: undefined }), handler('ran')),
    );

    expect(result).toBe('ran');
    expect(claim).not.toHaveBeenCalled();
  });

  it('runs the handler and remembers the answer', async () => {
    claim.mockResolvedValue({ outcome: 'claimed' });

    const result = await firstValueFrom(
      interceptor.intercept(context({ key: 'key-00000001' }), handler({ id: 'measurement-1' })),
    );

    expect(result).toEqual({ id: 'measurement-1' });
    expect(complete).toHaveBeenCalledWith('user-1', 'key-00000001', 'fingerprint', {
      id: 'measurement-1',
    });
  });

  it('returns the stored answer without running the handler again', async () => {
    claim.mockResolvedValue({ outcome: 'replay', body: { id: 'measurement-1' } });

    let ran = false;
    const result = await firstValueFrom(
      interceptor.intercept(context({ key: 'key-00000001' }), {
        handle: () => {
          ran = true;
          return of('ran');
        },
      }),
    );

    expect(result).toEqual({ id: 'measurement-1' });
    expect(ran).toBe(false);
    expect(headers['Idempotent-Replay']).toBe('true');
  });

  it('refuses while the first attempt is still running', async () => {
    claim.mockResolvedValue({ outcome: 'in_flight' });

    await expect(
      firstValueFrom(interceptor.intercept(context({ key: 'key-00000001' }), handler('ran'))),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a key reused for a different write', async () => {
    claim.mockResolvedValue({ outcome: 'reused' });

    await expect(
      firstValueFrom(interceptor.intercept(context({ key: 'key-00000001' }), handler('ran'))),
    ).rejects.toThrow(ConflictException);
  });

  it('lets the write through when the store is unreachable', async () => {
    claim.mockResolvedValue({ outcome: 'unavailable' });

    const result = await firstValueFrom(
      interceptor.intercept(context({ key: 'key-00000001' }), handler('ran')),
    );

    expect(result).toBe('ran');
    expect(complete).not.toHaveBeenCalled();
  });

  it('frees the key when the handler fails', async () => {
    claim.mockResolvedValue({ outcome: 'claimed' });

    await expect(
      firstValueFrom(
        interceptor.intercept(context({ key: 'key-00000001' }), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');

    expect(release).toHaveBeenCalledWith('user-1', 'key-00000001');
    expect(complete).not.toHaveBeenCalled();
  });
});
