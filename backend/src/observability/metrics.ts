import { collectDefaultMetrics, Histogram, Registry } from '@prometheus-io/client';

/**
 * Dedicated registry rather than the global default, so tests can build a
 * clean one and metric registration cannot collide across processes.
 */
export const metricsRegistry = new Registry();

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  // route, not path: /patients/:id keeps cardinality bounded. Interpolating
  // real ids here would both explode the series count and leak identifiers
  // into a store that is not treated as clinical data.
  labelNames: ['method', 'route', 'status_code'] as const,
  // Tuned to the spec's targets: p95 < 300ms read, < 800ms write (section 9).
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.5, 3, 10],
  registers: [metricsRegistry],
});

let defaultsCollected = false;

export function registerDefaultMetrics(serviceName: string): void {
  if (defaultsCollected) {
    return;
  }

  metricsRegistry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({ register: metricsRegistry });
  defaultsCollected = true;
}
