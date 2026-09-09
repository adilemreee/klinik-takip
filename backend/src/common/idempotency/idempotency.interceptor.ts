import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, from, of, concatMap } from 'rxjs';
import type { RequestWithUser } from '../../auth/decorators/current-user.decorator';
import { IdempotencyService } from './idempotency.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';

/** Methods that change something and are therefore worth not doing twice. */
const GUARDED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * A key the server will accept: long enough not to collide, plain enough to
 * put in a Redis key and a log line. A UUID fits.
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Makes a repeated write happen once (spec M15).
 *
 * The client keeps writes it could not deliver and sends them when the
 * connection returns. It cannot tell a request that never arrived from one
 * that arrived, committed, and lost its answer on the way back — so it sends
 * the same key with every attempt, and this hands back the first answer
 * instead of doing the work again.
 *
 * Opt-in by header rather than applied to every write: a request without a key
 * behaves exactly as it always did, which keeps this out of the way of every
 * caller that is not a queue.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const key = request.headers[IDEMPOTENCY_HEADER];

    if (typeof key !== 'string' || !GUARDED_METHODS.has(request.method)) {
      return next.handle();
    }

    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('IDEMPOTENCY_KEY_INVALID');
    }

    const userId = request.user?.id;

    // An unauthenticated route has nobody to scope the key to, and a key that
    // is not scoped is one account replaying another's answer.
    if (!userId) {
      return next.handle();
    }

    // The route pattern where Express provides one, so two writes to
    // different patients are still the same shape of request; the URL is the
    // fallback and is just as usable as a fingerprint input.
    const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
    const path = typeof route === 'string' ? route : (request.originalUrl ?? request.url);
    const fingerprint = this.idempotency.fingerprint(request.method, path, request.body);
    const response = context.switchToHttp().getResponse<Response>();

    return from(this.idempotency.claim(userId, key, fingerprint)).pipe(
      concatMap((claim): Observable<unknown> => {
        switch (claim.outcome) {
          case 'replay':
            // Said in a header rather than in the body: the body must be
            // byte-for-byte what the first attempt returned, or a client that
            // parses it has to know about this feature to read its own record.
            response.setHeader('Idempotent-Replay', 'true');
            return of(claim.body);

          case 'in_flight':
            // The first attempt is still running. Retryable, and the client's
            // queue treats a 409 with this code as "try again shortly" rather
            // than as something a person has to look at.
            throw new ConflictException('IDEMPOTENCY_IN_FLIGHT');

          case 'reused':
            throw new ConflictException('IDEMPOTENCY_KEY_REUSED');

          case 'unavailable':
            // Redis is down. The write proceeds unprotected: a duplicate
            // reading is bad, and refusing every write in the clinic is worse.
            return next.handle();

          case 'claimed':
            return this.run(next, userId, key, fingerprint);
        }
      }),
    );
  }

  private run(
    next: CallHandler,
    userId: string,
    key: string,
    fingerprint: string,
  ): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      const subscription = next.handle().subscribe({
        next: (value: unknown) => {
          // The answer is stored before it is sent. Storing it afterwards
          // would leave the window this whole thing exists to close.
          void this.idempotency
            .complete(userId, key, fingerprint, value)
            .catch(() => undefined)
            .then(() => {
              subscriber.next(value);
              subscriber.complete();
            });
        },
        error: (error: unknown) => {
          // A failed write changed nothing worth remembering, and holding the
          // key would turn one server error into a change the user cannot
          // retry for a minute.
          void this.idempotency
            .release(userId, key)
            .catch(() => undefined)
            .then(() => subscriber.error(error));
        },
      });

      return () => subscription.unsubscribe();
    });
  }
}
