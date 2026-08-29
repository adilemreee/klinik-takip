import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Derives the Postman collection from the OpenAPI contract.
 *
 * Written here rather than taken from a library for two reasons. The published
 * converter pulls 58 packages — with five known advisories at the time of
 * writing — into the tree for what is only a documentation artefact. And it
 * stamps a fresh UUID into every item on every run, so the output could never
 * be committed and checked for drift, which is the whole point of generating it.
 *
 * This produces byte-identical output for identical input.
 */

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  example?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  nullable?: boolean;
  default?: unknown;
}

interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description?: string;
  schema?: Schema;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
}

interface Spec {
  info: { title: string; description?: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

const spec = JSON.parse(
  readFileSync(resolve(__dirname, '../../docs/openapi.json'), 'utf8'),
) as Spec;

/** Resolves a local $ref against components.schemas. */
function deref(schema: Schema | undefined, depth = 0): Schema | undefined {
  if (!schema?.$ref || depth > 10) {
    return schema;
  }

  const name = schema.$ref.replace('#/components/schemas/', '');

  return deref(spec.components?.schemas?.[name], depth + 1);
}

/** Query and path values are scalars; anything structured has no place in a URL. */
function scalarExample(schema: Schema | undefined): string {
  const value = example(schema);

  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';
}

/**
 * Form fields for a multipart body: file parts as file pickers, everything else
 * as text prefilled with its default or first allowed value.
 */
function formData(schema: Schema): Record<string, unknown>[] {
  const properties = schema.properties ?? {};

  return Object.entries(properties).map(([name, property]) => {
    const field = property;

    if (field.format === 'binary') {
      return { key: name, type: 'file', src: [] };
    }

    const value = field.default ?? field.enum?.[0] ?? '';

    return { key: name, type: 'text', value: String(value) };
  });
}

/** A minimal, representative body so a request is runnable after pasting a token. */
function example(schema: Schema | undefined, depth = 0): unknown {
  const resolved = deref(schema);

  if (!resolved || depth > 6) {
    return null;
  }

  if (resolved.example !== undefined) {
    return resolved.example;
  }

  if (resolved.enum?.length) {
    return resolved.enum[0];
  }

  switch (resolved.type) {
    case 'array':
      return [example(resolved.items, depth + 1)].filter((value) => value !== null);
    case 'object': {
      const result: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(resolved.properties ?? {})) {
        result[key] = example(property, depth + 1);
      }
      return result;
    }
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      if (resolved.format === 'date-time') return '2026-01-01T00:00:00.000Z';
      if (resolved.format === 'date') return '1990-01-01';
      if (resolved.format === 'uuid') return '00000000-0000-7000-8000-000000000000';
      return '';
    default:
      return null;
  }
}

interface PostmanItem {
  name: string;
  request: Record<string, unknown>;
}

const folders = new Map<string, PostmanItem[]>();

for (const [path, operations] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const operation = operations[method];
    if (!operation) {
      continue;
    }

    const tag = operation.tags?.[0] ?? 'other';
    const parameters = operation.parameters ?? [];

    // Postman uses :name for path variables where OpenAPI uses {name}.
    const segments = path.split('/').filter(Boolean).map((segment) =>
      segment.startsWith('{') ? `:${segment.slice(1, -1)}` : segment,
    );

    const query = parameters
      .filter((p) => p.in === 'query')
      .map((p) => ({
        key: p.name,
        value: p.required ? scalarExample(p.schema) : '',
        description: p.description,
        // Optional parameters are present but disabled, so they are discoverable
        // without being sent by accident.
        disabled: !p.required,
      }));

    const pathVariables = parameters
      .filter((p) => p.in === 'path')
      .map((p) => ({ key: p.name, value: '', description: p.description }));

    const bodySchema = operation.requestBody?.content?.['application/json']?.schema;
    const multipartSchema = operation.requestBody?.content?.['multipart/form-data']?.schema;
    const binaryBody = operation.requestBody?.content?.['application/octet-stream'] !== undefined;

    const request: Record<string, unknown> = {
      method: method.toUpperCase(),
      header: bodySchema ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url: {
        raw: `{{baseUrl}}/${segments.join('/')}`,
        host: ['{{baseUrl}}'],
        path: segments,
        ...(query.length ? { query } : {}),
        ...(pathVariables.length ? { variable: pathVariables } : {}),
      },
      description: operation.description ?? operation.summary,
    };

    if (bodySchema) {
      request.body = {
        mode: 'raw',
        raw: JSON.stringify(example(bodySchema), null, 2),
        options: { raw: { language: 'json' } },
      };
    } else if (multipartSchema) {
      // File uploads become a form-data body rather than being skipped: a
      // collection that cannot exercise the upload endpoint is a collection
      // that stops being used for the one request hardest to hand-build.
      // Content-Type is left to Postman, which has to add the boundary.
      request.body = { mode: 'formdata', formdata: formData(multipartSchema) };
    } else if (binaryBody) {
      // A raw chunk. Postman sends the chosen file as the whole body, which is
      // exactly what the resumable upload endpoint expects.
      request.body = { mode: 'file', file: { src: '' } };
    }

    const items = folders.get(tag) ?? [];
    items.push({ name: operation.summary ?? `${method.toUpperCase()} ${path}`, request });
    folders.set(tag, items);
  }
}

const collection = {
  info: {
    name: spec.info.title,
    description: `${spec.info.description ?? ''}\n\nGenerated from docs/openapi.json — do not edit by hand.`.trim(),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:8123', type: 'string' },
    { key: 'accessToken', value: '', type: 'string' },
  ],
  item: [...folders.entries()].map(([name, items]) => ({ name, item: items })),
};

const target = resolve(__dirname, '../../docs/klinik-takip.postman_collection.json');
writeFileSync(target, `${JSON.stringify(collection, null, 2)}\n`);

const requestCount = [...folders.values()].reduce((total, items) => total + items.length, 0);
console.log(`Postman collection: ${folders.size} folders, ${requestCount} requests -> ${target}`);
