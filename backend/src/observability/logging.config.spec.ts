import pino, { type LoggerOptions } from 'pino';
import { buildLoggerParams } from './logging.config';

/**
 * These assertions are a security control, not a formatting preference. Logs
 * ship to Loki and are retained; anything that reaches a log line has left the
 * boundary we control.
 */
describe('log redaction', () => {
  const logAndCapture = (payload: Record<string, unknown>): string => {
    const lines: string[] = [];
    const params = buildLoggerParams({ APP_ENV: 'production', LOG_LEVEL: 'info', SERVICE_NAME: 'test' });
    const options = params.pinoHttp as LoggerOptions;

    const logger = pino(
      { level: options.level, redact: options.redact },
      { write: (line: string): void => void lines.push(line) },
    );

    logger.info(payload, 'test');

    return lines.join('');
  };

  it('redacts the authorization header', () => {
    const output = logAndCapture({ req: { headers: { authorization: 'Bearer sk-live-abc123' } } });

    expect(output).not.toContain('sk-live-abc123');
    expect(output).toContain('[redacted]');
  });

  it('redacts cookies in both directions', () => {
    const output = logAndCapture({
      req: { headers: { cookie: 'session=abc' } },
      res: { headers: { 'set-cookie': 'session=xyz' } },
    });

    expect(output).not.toContain('abc');
    expect(output).not.toContain('xyz');
  });

  it.each([
    ['password', 'hunter2'],
    ['refreshToken', 'rt-secret-value'],
    ['totpSecret', 'JBSWY3DPEHPK3PXP'],
  ])('redacts %s', (field, value) => {
    const output = logAndCapture({ user: { [field]: value } });

    expect(output).not.toContain(value);
  });

  // Special-category data. A stack trace or a debug object must never carry it.
  it.each([
    ['mrn', 'MRN-90210'],
    ['nationalId', '12345678901'],
    ['birthDate', '1972-04-11'],
    ['phone', '+905551112233'],
    ['diagnosis', 'post-op wound infection'],
  ])('redacts patient identifier %s', (field, value) => {
    const output = logAndCapture({ patient: { [field]: value } });

    expect(output).not.toContain(value);
  });

  it('still logs the non-sensitive fields around them', () => {
    const output = logAndCapture({ patient: { mrn: 'MRN-1', status: 'active' } });

    expect(output).toContain('active');
  });
});

describe('request serialisation', () => {
  it('drops the query string, which can carry clinical parameters', () => {
    const params = buildLoggerParams({ APP_ENV: 'production', LOG_LEVEL: 'info', SERVICE_NAME: 'test' });
    const options = params.pinoHttp as LoggerOptions;
    const serialise = options.serializers?.req as (req: unknown) => { path: string };

    const result = serialise({ id: 'r1', method: 'GET', url: '/patients?mrn=MRN-90210' });

    expect(result.path).toBe('/patients');
    expect(JSON.stringify(result)).not.toContain('MRN-90210');
  });

  it('does not include a body field at all', () => {
    const params = buildLoggerParams({ APP_ENV: 'production', LOG_LEVEL: 'info', SERVICE_NAME: 'test' });
    const options = params.pinoHttp as LoggerOptions;
    const serialise = options.serializers?.req as (req: unknown) => Record<string, unknown>;

    const result = serialise({ id: 'r1', method: 'POST', url: '/patients', body: { secret: 1 } });

    expect(result).not.toHaveProperty('body');
    expect(Object.keys(result).sort()).toEqual(['id', 'method', 'path']);
  });
});
