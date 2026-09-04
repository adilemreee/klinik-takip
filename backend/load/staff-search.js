import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

/**
 * The staff patient list under load (T7.1).
 *
 * The heaviest read in the system and the one most likely to fall over: a
 * fuzzy name search across every patient the caller may see, ordered and
 * paged. It is also the query whose index the Prisma migrations keep trying to
 * drop, which is why measuring it is worth more than measuring another `me`
 * endpoint.
 *
 * Search terms are deliberately partial and varied. A single repeated query
 * measures the query cache; a coordinator typing "yıl" measures the index.
 */

const search = new Trend('search_duration', true);
const page = new Trend('page_duration', true);
const failures = new Rate('failed_requests');

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const IDENTIFIER = __ENV.IDENTIFIER;
const PASSWORD = __ENV.PASSWORD;
const TOTP = __ENV.TOTP;

// Partial, accented, and mixed case — what somebody actually types.
const TERMS = ['yil', 'meh', 'kaya', 'cel', 'ozt', 'ayse', 'dem', 'sah', 'elif', 'yildi'];

export const options = {
  scenarios: {
    staff: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        // Fewer than the patient scenario on purpose: a clinic has tens of
        // staff, not hundreds, and pretending otherwise measures a load that
        // will never arrive.
        { duration: '20s', target: 20 },
        { duration: '60s', target: 50 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    // A list that takes longer than this is one a coordinator types over.
    'search_duration': ['p(95)<1000'],
  },
};

export function setup() {
  const body = { identifier: IDENTIFIER, password: PASSWORD };
  if (TOTP) body.totpCode = TOTP;

  const response = http.post(`${BASE}/auth/login`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status !== 200) {
    throw new Error(`Could not sign in: ${response.status} ${response.body}`);
  }

  const token = response.json('accessToken');
  if (!token) throw new Error(`No token; status was ${response.json('status')}`);

  return { token };
}

export default function (data) {
  const auth = { headers: { Authorization: `Bearer ${data.token}` } };
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];

  const first = http.get(
    `${BASE}/patients?q=${encodeURIComponent(term)}&limit=25`,
    { ...auth, tags: { name: 'search' } },
  );

  search.add(first.timings.duration);
  const ok = check(first, { 'search ok': (r) => r.status === 200 });
  failures.add(!ok);

  // Paging is where a cursor implementation goes wrong under load, so the
  // second page is part of the measurement rather than an afterthought.
  if (ok) {
    const cursor = first.json('nextCursor');

    if (cursor) {
      const second = http.get(
        `${BASE}/patients?q=${encodeURIComponent(term)}&limit=25&cursor=${cursor}`,
        { ...auth, tags: { name: 'page' } },
      );

      page.add(second.timings.duration);
      failures.add(!check(second, { 'page ok': (r) => r.status === 200 }));
    }
  }

  sleep(Math.random() * 2 + 0.5);
}
