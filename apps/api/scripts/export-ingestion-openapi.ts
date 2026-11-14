import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createIngestionOpenApi } from '../src/openapi/export.js';

const path = resolve('../../docs/contracts/R1-008B-ingestion.openapi.json');
const document = await createIngestionOpenApi();
if (process.argv.includes('--write')) {
  await writeFile(path, JSON.stringify(document, null, 2) + '\n');
} else {
  assert.deepEqual(
    JSON.parse(await readFile(path, 'utf8')),
    JSON.parse(JSON.stringify(document)),
  );
  console.log('PASS R1-008B OpenAPI matches implemented routes');
}
