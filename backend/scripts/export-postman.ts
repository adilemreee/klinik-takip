import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convert, type CollectionResult } from 'openapi-to-postmanv2';

/**
 * Generates the Postman collection from the OpenAPI contract rather than by
 * hand.
 *
 * A hand-maintained collection drifts from the API within weeks and then
 * teaches people the wrong thing. Deriving it means the two cannot disagree.
 */
const specPath = resolve(__dirname, '../../docs/openapi.json');
const target = resolve(__dirname, '../../docs/klinik-takip.postman_collection.json');

const spec = readFileSync(specPath, 'utf8');

convert(
  { type: 'string', data: spec },
  {
    folderStrategy: 'Tags',
    requestParametersResolution: 'Example',
    exampleParametersResolution: 'Example',
    enableOptionalParameters: false,
  },
  (error: { message: string } | null, result?: CollectionResult) => {
    if (error) {
      console.error(`Conversion failed: ${error.message}`);
      process.exitCode = 1;
      return;
    }

    if (!result?.result) {
      console.error(`Conversion failed: ${result?.reason ?? 'unknown reason'}`);
      process.exitCode = 1;
      return;
    }

    const collection = result.output?.[0]?.data as Record<string, unknown> | undefined;

    if (!collection) {
      console.error('Conversion produced no collection');
      process.exitCode = 1;
      return;
    }

    // A collection-level bearer variable, so a tester pastes their token once
    // instead of into every request.
    collection.auth = {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    };
    collection.variable = [
      { key: 'baseUrl', value: 'http://localhost:8123', type: 'string' },
      { key: 'accessToken', value: '', type: 'string' },
    ];

    writeFileSync(target, `${JSON.stringify(collection, null, 2)}\n`);
    console.log(`Postman collection -> ${target}`);
  },
);
