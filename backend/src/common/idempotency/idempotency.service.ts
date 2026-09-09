import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../infra/redis.service';

/** How long a claim survives while the request is still running. */
const IN_FLIGHT_TTL_SECONDS = 60;

/**
 * How long a finished answer is replayable.
 *
 * A day, because that is the outer bound of the situation this exists for: a
 * patient whose phone queued a write on a flight and opens the app after
 * landing. Longer would keep clinical response bodies in Redis for no further
 * benefit.
 */
const COMPLETED_TTL_SECONDS = 24 * 60 * 60;

/**
 * Bodies larger than this are not stored.
 *
 * Every write in this API answers with one record; anything approaching this
 * is a mistake somewhere else, and filling Redis with it would cost the cache
 * that keeps permission checks off the database.
 */
const MAXIMUM_STORED_BODY_BYTES = 256 * 1024;

export type IdempotencyRecord =
  | { state: 'in_flight'; fingerprint: string }
  | { state: 'done'; fingerprint: string; body: string | null };

export type ClaimResult =
  | { outcome: 'claimed' }
  /** Redis could not be reached; the request runs unprotected. */
  | { outcome: 'unavailable' }
  | { outcome: 'in_flight' }
  | { outcome: 'reused' }
  | { outcome: 'replay'; body: unknown };

/**
 * Remembers what a write already did, so sending it twice does it once.
 *
 * The client queues writes that could not be delivered (spec M15) and sends
 * them when the connection comes back. The dangerous case is not the one that
 * failed — it is the one that reached the server, committed, and lost its
 * answer on the way home: the phone still has it queued, and replaying it adds
 * a second dose log, a second complication, a second message.
 *
 * So a write carries a key the client generates once and keeps across every
 * attempt, and this remembers the answer against it.
 *
 * Redis rather than the database because the record is short-lived and the
 * check sits on the write path. If Redis is unreachable the request proceeds
 * without protection: a duplicate measurement is a bad outcome, and refusing
 * every write in the clinic is a worse one.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * What the key covers.
   *
   * Includes the request itself, so a client that reuses a key for a different
   * write is told rather than handed the earlier answer — which would look
   * exactly like success and silently drop the second change.
   */
  fingerprint(method: string, path: string, body: unknown): string {
    const serialised = body === undefined ? '' : JSON.stringify(body);

    return createHash('sha256')
      .update(`${method}\n${path}\n${serialised ?? ''}`)
      .digest('hex');
  }

  /**
   * Scoped to the user.
   *
   * Without it, one account could replay another's key and be handed a record
   * it never had the right to see.
   */
  private redisKey(userId: string, key: string): string {
    return `idem:${userId}:${key}`;
  }

  async claim(userId: string, key: string, fingerprint: string): Promise<ClaimResult> {
    const redisKey = this.redisKey(userId, key);
    const claim: IdempotencyRecord = { state: 'in_flight', fingerprint };

    let stored: string | null;

    try {
      const written = await this.redis.client.set(
        redisKey,
        JSON.stringify(claim),
        'EX',
        IN_FLIGHT_TTL_SECONDS,
        'NX',
      );

      if (written === 'OK') {
        return { outcome: 'claimed' };
      }

      stored = await this.redis.client.get(redisKey);
    } catch (error) {
      this.logger.warn(`Idempotency check skipped: ${String(error)}`);
      return { outcome: 'unavailable' };
    }

    if (!stored) {
      // The entry expired between the SET and the GET. Treat it as ours: the
      // alternative is refusing a write because of a race with a timer.
      return { outcome: 'claimed' };
    }

    const record = this.parse(stored);

    if (!record) {
      return { outcome: 'claimed' };
    }

    if (record.fingerprint !== fingerprint) {
      return { outcome: 'reused' };
    }

    if (record.state === 'in_flight') {
      return { outcome: 'in_flight' };
    }

    return {
      outcome: 'replay',
      body: record.body === null ? null : (JSON.parse(record.body) as unknown),
    };
  }

  /**
   * Stores the answer, so the next attempt is handed it instead of running.
   *
   * The body only. The status code belongs to the route, which declares one
   * and applies it to the replay exactly as it did to the original — storing a
   * second copy of it would only create something that could disagree.
   */
  async complete(userId: string, key: string, fingerprint: string, body: unknown): Promise<void> {
    const serialised = body === undefined || body === null ? null : JSON.stringify(body);

    if (serialised !== null && Buffer.byteLength(serialised) > MAXIMUM_STORED_BODY_BYTES) {
      // Nothing is stored, so a replay re-runs the request. Said out loud
      // rather than silently, because it means this write is not protected.
      this.logger.warn(`Response too large to remember for idempotency key ${key}`);
      await this.release(userId, key);
      return;
    }

    const record: IdempotencyRecord = { state: 'done', fingerprint, body: serialised };

    try {
      await this.redis.client.set(
        this.redisKey(userId, key),
        JSON.stringify(record),
        'EX',
        COMPLETED_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`Idempotent response was not stored: ${String(error)}`);
    }
  }

  /**
   * Drops the claim after a failure.
   *
   * A request that ended in an error changed nothing worth remembering, and
   * holding the key for a minute would turn one server error into a write the
   * user cannot retry.
   */
  async release(userId: string, key: string): Promise<void> {
    try {
      await this.redis.client.del(this.redisKey(userId, key));
    } catch (error) {
      this.logger.warn(`Idempotency claim was not released: ${String(error)}`);
    }
  }

  private parse(stored: string): IdempotencyRecord | null {
    try {
      return JSON.parse(stored) as IdempotencyRecord;
    } catch {
      return null;
    }
  }
}
