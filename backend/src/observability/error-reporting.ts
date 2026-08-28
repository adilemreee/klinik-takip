import * as Sentry from '@sentry/node';
import { Env } from '../config/env.schema';

/**
 * Error reporting via the Sentry SDK, pointed at a self-hosted GlitchTip.
 *
 * GlitchTip speaks the Sentry protocol, so the SDK is unchanged, but the data
 * stays on our own server. Sending stack traces from a clinical system to a
 * third-party SaaS would export health data to a processor we have no
 * agreement with (spec section 8, KVKK).
 *
 * Must run before the Nest application is created so early failures are caught.
 */
export function initErrorReporting(env: Env): void {
  if (!env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    // Never attach cookies, headers, IP addresses or request bodies.
    sendDefaultPii: false,
    tracesSampleRate: env.APP_ENV === 'production' ? 0.1 : 0,

    beforeSend(event) {
      // Belt and braces: even with sendDefaultPii off, drop anything that could
      // carry patient content before it leaves the process.
      delete event.user;
      delete event.breadcrumbs;

      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.headers;
        delete event.request.query_string;
        // Strip the query string from the URL too.
        event.request.url = event.request.url?.split('?')[0];
      }

      return event;
    },
  });
}

export { Sentry };
