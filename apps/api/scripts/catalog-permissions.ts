import { runCatalogPermissionCli } from '../src/cli/catalog-permissions.js';

try {
  await runCatalogPermissionCli(process.argv.slice(2));
} catch (error) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'INTERNAL_ERROR';
  console.error(`Catalog permission initialization failed: ${code}`);
  process.exitCode = 1;
}
