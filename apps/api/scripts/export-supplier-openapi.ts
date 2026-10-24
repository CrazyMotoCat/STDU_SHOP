import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupplierRuntimeOpenApi } from '../src/openapi/export.js';

const repositoryRoot = resolve(
  fileURLToPath(new URL('../../../', import.meta.url)),
);
try {
  const document = await createSupplierRuntimeOpenApi();
  const output = resolve(
    repositoryRoot,
    '.local/contracts/generated-supplier.openapi.json',
  );
  await mkdir(resolve(repositoryRoot, '.local/contracts'), { recursive: true });
  await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Generated Nest supplier OpenAPI: ${output}`);
} catch (error) {
  console.error(
    'Supplier OpenAPI export failed:',
    error instanceof Error ? error.stack : JSON.stringify(error),
  );
  process.exitCode = 1;
}
