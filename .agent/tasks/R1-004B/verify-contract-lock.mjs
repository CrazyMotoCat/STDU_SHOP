import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const lock = JSON.parse(
  await readFile(new URL('./contract-lock.json', import.meta.url), 'utf8'),
);
const args = process.argv.slice(2);
assert(args.every((arg) => arg === '--baseline'), 'Unknown verification option');
assert.equal(lock.contractVersion, '1.0.0');
assert.equal(lock.textNormalization, 'UTF-8 LF (CRLF normalized to LF)');
assert.equal(
  lock.approvedSourceSha,
  '8ae4dd8cfd15e3722d97259818b238924851c963',
);

async function verifyFiles(entries) {
  for (const [relativePath, expectedHash] of Object.entries(entries)) {
    const path = resolve(root, relativePath);
    assert(path.startsWith(`${root}${sep}`), 'Lock path escapes repository');
    const actualHash = createHash('sha256')
      .update((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'))
      .digest('hex');
    assert.equal(actualHash, expectedHash, `Artifact drift: ${relativePath}`);
  }
  return Object.keys(entries).length;
}

let count = 0;
for (const group of Object.values(lock.protectedArtifacts)) {
  count += await verifyFiles(group);
}
for (const name of ['data-model', 'rbac-matrix', 'audit-registry']) {
  const artifact = JSON.parse(
    await readFile(resolve(root, `docs/contracts/R1-004-catalog-${name}.json`)),
  );
  assert.equal(artifact.status, 'FROZEN');
  assert.equal(artifact.version, lock.contractVersion);
  assert.equal(artifact.approvedSourceSha, lock.approvedSourceSha);
}
console.log(`PASS locked frozen artifacts: ${count}; approved source ${lock.approvedSourceSha}.`);

if (args.includes('--baseline')) {
  const baselineCount = await verifyFiles(lock.databaseBaseline.files);
  console.log(`PASS pre-implementation Prisma baseline: ${baselineCount} files; ${lock.databaseBaseline.modelNames.length} staff models. No database connection or mutation performed.`);
}
