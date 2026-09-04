import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

/**
 * A patient's day, at load (T7.1).
 *
 * Modelled on what the app actually does rather than on a single endpoint in a
 * loop: open the app, find out who you are, read the home screen, then look at
 * one or two of the things the home screen offers. Hammering one route measures
 * that route; this measures the shape of a real minute.
 *
 * Sign-in is deliberately outside the loop and its cost measured separately.
 * Argon2id is meant to be slow — 46 MiB and three passes — so a test that signs
 * in on every iteration measures the password hash and nothing else, and would
 * report a bottleneck that is a deliberate security property.
 *
 *   k6 run -e BASE_URL=... -e IDENTIFIER=... -e PASSWORD=... load/patient-day.js
 *
 * Never point this at a shared server. The staging host runs twenty-one other
 * services that people depend on.
 */

const signIn = new Trend('sign_in_duration', true);
const identity = new Trend('identity_duration', true);
const home = new Trend('home_duration', true);
const failures = new Rate('failed_requests');

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const IDENTIFIER = __ENV.IDENTIFIER;
const PASSWORD = __ENV.PASSWORD;

export const options = {
  scenarios: {
    patients: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Ramped rather than dropped in all at once: a cold connection pool
        // answering 500 simultaneous first requests measures the ramp, not the
        // steady state the clinic will actually live in.
        { duration: '30s', target: 100 },
        { duration: '30s', target: 500 },
        { duration: '60s', target: 500 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    // The spec asks for 500 concurrent. These are what "it held" means.
    'http_req_failed': ['rate<0.01'],
    'identity_duration': ['p(95)<500'],
    'home_duration': ['p(95)<800'],
  },
};

function authenticate() {
  const response = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  signIn.add(response.timings.duration);

  const ok = check(response, { 'signed in': (r) => r.status === 200 });
  failures.add(!ok);

  return ok ? response.json('accessToken') : null;
}

export function setup() {
  if (!IDENTIFIER || !PASSWORD) {
    throw new Error('Set IDENTIFIER and PASSWORD');
  }

  // One token for the whole run. See the note above about Argon2id.
  const token = authenticate();
  if (!token) throw new Error('Could not sign in');

  return { token };
}

export default function (data) {
  const auth = {
    headers: { Authorization: `Bearer ${data.token}` },
  };

  group('open the app', () => {
    const response = http.get(`${BASE}/me/identity`, {
      ...auth,
      tags: { name: 'identity' },
    });

    identity.add(response.timings.duration);
    failures.add(!check(response, { 'identity ok': (r) => r.status === 200 }));
  });

  group('home screen', () => {
    const response = http.get(`${BASE}/me/summary`, { ...auth, tags: { name: 'summary' } });

    home.add(response.timings.duration);
    failures.add(!check(response, { 'summary ok': (r) => r.status === 200 }));
  });

  // What a patient actually opens next, in rough proportion. Not uniform: the
  // point is to load the routes the app leans on, weighted the way it leans.
  const roll = Math.random();

  if (roll < 0.4) {
    const response = http.get(`${BASE}/me/medications`, { ...auth, tags: { name: 'medications' } });
    failures.add(!check(response, { 'medications ok': (r) => r.status === 200 }));
  } else if (roll < 0.7) {
    const response = http.get(`${BASE}/me/follow-up`, { ...auth, tags: { name: 'follow-up' } });
    failures.add(!check(response, { 'follow-up ok': (r) => r.status === 200 }));
  } else if (roll < 0.9) {
    const response = http.get(`${BASE}/me/appointments`, { ...auth, tags: { name: 'appointments' } });
    failures.add(!check(response, { 'appointments ok': (r) => r.status === 200 }));
  } else {
    const response = http.get(`${BASE}/me/documents`, { ...auth, tags: { name: 'documents' } });
    failures.add(!check(response, { 'documents ok': (r) => r.status === 200 }));
  }

  // A person reads the screen. Without this every VU is a busy loop and the
  // number reported is how fast k6 can ask, not how many people fit.
  sleep(Math.random() * 3 + 1);
}
