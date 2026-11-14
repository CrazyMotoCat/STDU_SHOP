import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const read = (file) => readFile(new URL(file, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('R1-010D-sec-api-02-manifest.json'));
assert.equal(manifest.version, '1.0.2');
assert.equal(manifest.baselineVersion, '1.0.1');
assert.equal(
  manifest.approvedSourceHead,
  'a7bc754a3da1c4ee4cbcc2db04e825f2172ed281',
);
assert.equal(manifest.scope, 'mock-only synthetic test profile');
for (const artifact of [
  'R1-010D-amendment-SEC-API-02.md',
  'R1-010D-frozen-manifest.json',
]) {
  const hash = createHash('sha256')
    .update((await read(artifact)).replace(/\r\n/g, '\n'))
    .digest('hex');
  assert.equal(hash, manifest.sha256[artifact], artifact);
}
console.log('R1-010D SEC-API-02 mock amendment 1.0.2: PASS');
