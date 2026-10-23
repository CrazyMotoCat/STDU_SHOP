import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStaffOpenApi } from '../src/openapi/export.js';

const output = resolve(
  process.cwd(),
  '../../.local/contracts/generated-staff.openapi.json',
);
await mkdir(resolve(output, '..'), { recursive: true });
try {
  const document = await createStaffOpenApi();
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Generated Nest Staff OpenAPI: ${output}`);
} catch (error) {
  console.error(
    'OpenAPI export failed:',
    typeof error,
    JSON.stringify(error),
    error instanceof Error ? error.stack : '',
  );
  process.exitCode = 1;
}
