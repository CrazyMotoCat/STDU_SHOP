import { resolve } from 'node:path';
import { compareOpenApi, readJson } from './openapi-contract.mjs';

const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath)
  throw new Error(
    'Usage: node scripts/compare-openapi.mjs <frozen> <generated>',
  );
const expected = await readJson(resolve(expectedPath));
const actual = await readJson(resolve(actualPath));
const result = compareOpenApi(expected, actual);
if (!result.equal) {
  console.error('OpenAPI semantic contract mismatch:');
  for (const difference of result.differences) console.error(`- ${difference}`);
  process.exitCode = 1;
} else {
  console.log('PASS frozen-to-Nest OpenAPI semantic equality (23 operations).');
}
