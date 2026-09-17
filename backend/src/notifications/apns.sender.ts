import { createPrivateKey, KeyObject, sign } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import type { Deliverable, DeliveryResult, NotificationSender } from './senders';

export interface ApnsConfig {
  /** The ten-character Key ID, printed on the key in App Store Connect. */
  keyId: string;
  teamId: string;
  /** The app's bundle identifier. */
  topic: string;
  /** The .p8 contents, in PEM. */
  privateKey: string;
  /**
   * Which gateway.
   *
   * Not a preference: a token minted by a build signed `aps-environment:
   * development` is rejected by the production host and the other way round,
   * and the error for the mismatch is `BadDeviceToken` — the same error as a
   * token that was never valid. Getting this wrong looks exactly like an app
   * that never registered.
   */
  production: boolean;
}

/** Apple refuses a token older than an hour and rate-limits minting them. */
const TOKEN_LIFETIME_MS = 40 * 60 * 1000;

const HOST_PRODUCTION = 'https://api.push.apple.com';
const HOST_SANDBOX = 'https://api.sandbox.push.apple.com';

/** Apple's own word for "this device is gone; stop sending to it". */
const DEAD_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
]);

/**
 * Push, over APNs, with a signed key.
 *
 * Written against `node:http2` and `node:crypto` rather than a client library
 * because that is all it is: one POST per notification, and a JWT this signs
 * itself. A dependency here would be a supply chain in front of the one
 * channel that carries "your lab result is critical".
 *
 * The provider token is cached for forty minutes. Apple rejects one older than
 * an hour and rate-limits minting them, so a token per notification is a way
 * to be throttled on the busiest morning.
 */
export class ApnsSender implements NotificationSender {
  readonly channel = NotificationChannel.PUSH;

  private readonly logger = new Logger('ApnsSender');
  private readonly key: KeyObject;
  private readonly host: string;

  private token: { value: string; mintedAt: number } | null = null;
  private session: ClientHttp2Session | null = null;

  constructor(private readonly config: ApnsConfig) {
    this.key = createPrivateKey(config.privateKey);
    this.host = config.production ? HOST_PRODUCTION : HOST_SANDBOX;
  }

  async send(message: Deliverable): Promise<DeliveryResult> {
    try {
      const response = await this.post(message);

      if (response.status === 200) {
        return { delivered: true };
      }

      const reason = readReason(response.body);

      /*
       * A dead token is reported as such rather than as a failure.
       *
       * The caller stops using the address when it hears this, which is what
       * keeps the notification log from filling with the same refusal every
       * morning for a phone that was reinstalled months ago.
       */
      if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) {
        return { delivered: false, reason, addressGone: true };
      }

      this.logger.warn(`APNs refused a notification: ${response.status} ${reason}`);

      return { delivered: false, reason };
    } catch (error) {
      // A network failure is not a dead token: the address is kept and the
      // fallback chain gets its turn.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`APNs unreachable: ${reason}`);

      return { delivered: false, reason };
    }
  }

  /** Closes the shared connection. Called when the process is shutting down. */
  close(): void {
    this.session?.close();
    this.session = null;
  }

  private post(message: Deliverable): Promise<{ status: number; body: string }> {
    const session = this.connection();

    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        aps: {
          alert: { title: message.title, body: message.body },
          sound: 'default',
        },
        ...(message.data ?? {}),
      });

      const request = session.request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${message.address}`,
        [constants.HTTP2_HEADER_SCHEME]: 'https',
        authorization: `bearer ${this.providerToken()}`,
        'apns-topic': this.config.topic,
        'apns-push-type': 'alert',
        // 10 is "deliver now". The alternative throttles to save battery, and
        // nothing this app sends is worth delaying.
        'apns-priority': '10',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });

      let status = 0;
      let body = '';

      request.setEncoding('utf8');
      request.on('response', (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => resolve({ status, body }));
      request.on('error', reject);

      request.end(payload);
    });
  }

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) {
      return this.session;
    }

    const session = connect(this.host);

    // Without this a dropped connection becomes an unhandled error event and
    // takes the process with it.
    session.on('error', (error: Error) => {
      this.logger.warn(`APNs connection lost: ${error.message}`);
      if (this.session === session) this.session = null;
    });
    session.on('close', () => {
      if (this.session === session) this.session = null;
    });

    this.session = session;

    return session;
  }

  private providerToken(): string {
    const now = Date.now();

    if (this.token && now - this.token.mintedAt < TOKEN_LIFETIME_MS) {
      return this.token.value;
    }

    const value = mintProviderToken(this.key, this.config.keyId, this.config.teamId, now);
    this.token = { value, mintedAt: now };

    return value;
  }
}

/**
 * The provider token Apple wants: an ES256 JWS over `{iss, iat}`.
 *
 * Exported so the shape can be checked without a network. The part worth
 * checking is the signature encoding — see below.
 */
export function mintProviderToken(
  key: KeyObject,
  keyId: string,
  teamId: string,
  now = Date.now(),
): string {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));

  /*
   * `ieee-p1363`, not DER.
   *
   * Node signs ECDSA as a DER sequence by default, and JWS wants the raw
   * r‖s pair. Apple answers a DER signature with `InvalidProviderToken`,
   * which reads like a wrong key rather than a wrong encoding — so this is a
   * mistake that costs an afternoon and looks like something else the whole
   * time.
   */
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

/** APNs answers a refusal with `{"reason":"BadDeviceToken"}`. */
function readReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { reason?: unknown };

    return typeof parsed.reason === 'string' ? parsed.reason : 'unknown';
  } catch {
    return body.slice(0, 120) || 'unknown';
  }
}
