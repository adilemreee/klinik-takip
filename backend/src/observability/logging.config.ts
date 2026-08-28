import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { Env } from '../config/env.schema';

/**
 * Fields scrubbed from every log line before it leaves the process.
 *
 * This service handles special-category health data (spec section 8). Logs are
 * shipped to Loki and kept for weeks, so anything that lands here outlives the
 * request. The rule is allow-list-shaped in practice: we log metadata about
 * requests, never their contents.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.totpSecret',
  '*.secret',
  '*.dsn',
  // Patient identifiers and clinical content must never reach a log line.
  '*.nationalId',
  '*.mrn',
  '*.birthDate',
  '*.phone',
  '*.email',
  '*.diagnosis',
  '*.note',
];

type LoggerEnv = Pick<Env, 'APP_ENV' | 'LOG_LEVEL' | 'SERVICE_NAME'> & { LOKI_URL?: string };

export function buildLoggerParams(env: LoggerEnv): Params {
  const isLocal = env.APP_ENV === 'local';

  // Redaction is applied by pino BEFORE any transport sees the line, so what
  // reaches Loki is already scrubbed.
  const transport = isLocal
    ? { target: 'pino-pretty', options: { singleLine: true } }
    : env.LOKI_URL
      ? {
          target: 'pino-loki',
          options: {
            host: env.LOKI_URL,
            batching: true,
            interval: 5,
            labels: { service: env.SERVICE_NAME, env: env.APP_ENV },
          },
        }
      : undefined;

  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },

      // Correlates every log line of one request, and is echoed back so a
      // patient-reported problem can be traced without asking for personal data.
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const existing = req.headers['x-request-id'];
        const id = (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },

      // Metadata only. Never the body, never the query string — both can carry
      // clinical content.
      serializers: {
        req: (req: IncomingMessage & { id: string; raw?: { url?: string } }) => ({
          id: req.id,
          method: req.method,
          // Path without the query string.
          path: (req.url ?? '').split('?')[0],
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },

      autoLogging: {
        // Probes fire every 15s from Docker and Prometheus; logging them buries
        // everything else.
        ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/health'),
      },

      transport,
    },
  };
}
