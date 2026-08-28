import { Logger } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { metricsRegistry } from './metrics';

/**
 * Metrics are served on their OWN port, never on the API port.
 *
 * The API is published to the internet through a tunnel that forwards every
 * path; a /metrics route on it would be world-readable. This listener is only
 * reachable on the internal docker network, where Prometheus scrapes it.
 */
export function startMetricsServer(port: number): Server {
  const logger = new Logger('Metrics');

  const server = createServer((req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }

    metricsRegistry
      .metrics()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': metricsRegistry.contentType });
        res.end(body);
      })
      .catch((error: unknown) => {
        logger.error(`Failed to collect metrics: ${String(error)}`);
        res.writeHead(500).end();
      });
  });

  server.listen(port, '0.0.0.0', () => logger.log(`Metrics listening on :${port}`));

  return server;
}
