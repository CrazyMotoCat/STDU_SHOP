import { resolve } from 'node:path';
import { compareOpenApi, readJson } from './openapi-contract.mjs';

const [expectedPath, actualPath, additivePermissionContract] =
  process.argv.slice(2);
if (!expectedPath || !actualPath)
  throw new Error(
    'Usage: node scripts/compare-openapi.mjs <frozen> <generated>',
  );
const expected = await readJson(resolve(expectedPath));
const actual = await readJson(resolve(actualPath));
const additions = additivePermissionContract
  ? Object.keys(
      (await readJson(resolve(additivePermissionContract))).permissions,
    )
  : [];
const result = compareOpenApi(expected, actual, {
  allowedPermissionCodeAdditions: additions,
});
if (!result.equal) {
  console.error('OpenAPI semantic contract mismatch:');
  for (const difference of result.differences) console.error(`- ${difference}`);
  process.exitCode = 1;
} else {
  console.log(
    `PASS frozen-to-Nest OpenAPI semantic equality (${Object.values(actual.paths).reduce((count, path) => count + Object.values(path).filter((operation) => operation && typeof operation === 'object' && 'responses' in operation).length, 0)} operations).`,
  );
}
