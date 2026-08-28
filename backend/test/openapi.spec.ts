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

  it('exposes cursor pagination rather than offsets', () => {
    const page = spec.components.schemas.PatientPageDto as { properties?: Record<string, unknown> };

    expect(page.properties).toHaveProperty('nextCursor');
    expect(page.properties).not.toHaveProperty('offset');
    expect(page.properties).not.toHaveProperty('page');
  });
});
