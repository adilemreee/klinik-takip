import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Operation {
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, { content?: unknown; description?: string }>;
}

interface Spec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

/**
 * Invariants the published contract has to keep.
 *
 * The mobile clients generate their networking layer from this file
 * (spec section 3.2), so an endpoint with no documented response body becomes
 * a generated method returning `void`, and an undocumented 403 becomes a client
 * that throws where it should branch. CI checks separately that the file still
 * matches the code; these tests check it is worth generating from at all.
 */
describe('the published API contract', () => {
  const spec = JSON.parse(
    readFileSync(resolve(__dirname, '../../docs/openapi.json'), 'utf8'),
  ) as Spec;

  const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
    METHODS.filter((method) => methods[method]).map((method) => ({
      id: `${method.toUpperCase()} ${path}`,
      path,
      method,
      operation: methods[method]!,
    })),
  );

  it('describes every route the application exposes', () => {
    expect(operations.length).toBeGreaterThanOrEqual(25);
  });

  it('declares a bearer security scheme', () => {
    expect(spec.components.securitySchemes).toHaveProperty('bearer');
  });

  it.each(operations.map((o) => [o.id, o.operation] as const))(
    '%s documents a success response',
    (_id, operation) => {
      const success = Object.entries(operation.responses ?? {}).filter(([code]) =>
        code.startsWith('2'),
      );

      expect(success.length).toBeGreaterThan(0);

      // Either a body, or an explicit no-content status.
      const usable = success.some(([code, response]) => code === '204' || response.content);
      expect(usable).toBe(true);
    },
  );

  it.each(operations.map((o) => [o.id, o.operation] as const))('%s has a summary', (_id, operation) => {
    expect(operation.summary).toBeTruthy();
  });

  it.each(operations.map((o) => [o.id, o.operation] as const))('%s is tagged', (_id, operation) => {
    expect(operation.tags?.length).toBeGreaterThan(0);
  });

  /**
   * Health probes are public by design; everything else must document what
   * happens when the caller is not allowed through.
   */
  it.each(
    operations
      .filter((o) => !o.path.startsWith('/health'))
      .map((o) => [o.id, o.operation] as const),
  )('%s documents 401 and 403', (_id, operation) => {
    expect(operation.responses).toHaveProperty('401');
    expect(operation.responses).toHaveProperty('403');
  });

  it('gives scoped patient routes a 404, since out-of-scope is reported as missing', () => {
    const scoped = operations.filter(
      (o) => o.path.startsWith('/patients/{id}') && o.method !== 'post',
    );

    expect(scoped.length).toBeGreaterThan(0);
    for (const { operation } of scoped) {
      expect(operation.responses).toHaveProperty('404');
    }
  });

  it('names the schemas the clients will generate', () => {
    const names = Object.keys(spec.components.schemas);

    expect(names).toEqual(
      expect.arrayContaining([
        'LoginResponseDto',
        'TokensDto',
        'SessionDto',
        'PatientDto',
        'PatientPageDto',
        'AuditPageDto',
        'ErrorResponseDto',
      ]),
    );
  });

  describe('the Postman collection derived from it', () => {
    interface PostmanRequest {
      name: string;
      request: { method: string; url: { path: string[]; raw: string }; body?: unknown };
    }
    interface Collection {
      info: { name: string; schema: string };
      auth?: { type: string };
      variable?: { key: string }[];
      item: { name: string; item: PostmanRequest[] }[];
    }

    const collection = JSON.parse(
      readFileSync(resolve(__dirname, '../../docs/klinik-takip.postman_collection.json'), 'utf8'),
    ) as Collection;

    const requests = collection.item.flatMap((folder) => folder.item);

    it('covers every documented operation', () => {
      expect(requests).toHaveLength(operations.length);
    });

    it('groups requests by tag', () => {
      expect(collection.item.map((folder) => folder.name).sort()).toEqual([
        'ai',
        'ai-reports',
        'analytics',
        'appointments',
        'assistant',
        'audit',
        'auth',
        'briefing',
        'complications',
        'consents',
        'documents',
        'emergency',
        'exports',
        'finance',
        'follow-up',
        'health',
        'lab',
        'me',
        'measurements',
        'medications',
        'messaging',
        'notifications',
        'patients',
        'photos',
        'protocols',
        'surveys',
      ]);
    });

    it('declares collection-level bearer auth and the two variables', () => {
      expect(collection.auth?.type).toBe('bearer');
      expect(collection.variable?.map((v) => v.key).sort()).toEqual(['accessToken', 'baseUrl']);
    });

    it('uses the baseUrl variable rather than a hard-coded host', () => {
      for (const request of requests) {
        expect(request.request.url.raw.startsWith('{{baseUrl}}/')).toBe(true);
      }
    });

    /**
     * Deterministic output is what makes the drift check possible: the published
     * converter stamps a fresh UUID into every item, so its output could never
     * be committed and compared.
     */
    it('contains no generated identifiers', () => {
      const raw = readFileSync(
        resolve(__dirname, '../../docs/klinik-takip.postman_collection.json'),
        'utf8',
      );

      expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
      expect(raw).not.toContain('_postman_id');
    });

    it('sends a JSON body only where the contract defines one', () => {
      const withBody = requests.filter((r) => r.request.body).length;
      const documentedBodies = operations.filter(
        (o) => (o.operation as { requestBody?: unknown }).requestBody,
      ).length;

      expect(withBody).toBe(documentedBodies);
    });
  });

  it('exposes cursor pagination rather than offsets', () => {
    const page = spec.components.schemas.PatientPageDto as { properties?: Record<string, unknown> };

    expect(page.properties).toHaveProperty('nextCursor');
    expect(page.properties).not.toHaveProperty('offset');
    expect(page.properties).not.toHaveProperty('page');
  });
});
