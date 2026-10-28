import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const approvedSourceArtifacts = {
  'docs/adr/ADR-005-malware-scanning.md':
    'a8d01e9bbae0a683dfb9228349739124c84063b8f691884ca92ad111a0468a72',
  'docs/proposals/R1-010D-malware-scanning-contract.md':
    '426fc4ece0dd45bc9454528e2edd89952a6835b0039aadc772da47247825cccd',
};
const frozenArtifacts = {
  'docs/adr/ADR-005-malware-scanning.md':
    'ce0e9d05b142a8286fcf2d6b15b24d64a339d4f477c33a9c6ca4ad8ee0fd39fd',
  'docs/contracts/R1-010D-malware-scan-contract.md':
    'ecf31de230a0b270dbfb62bdb086bb099368667ba571a20befb56c687c9e35d6',
};
const decisions = [
  'OD-010D-01',
  'OD-010D-02',
  'OD-010D-03',
  'OD-010D-04',
  'OD-010D-05',
];
const sha256 = (text) =>
  createHash('sha256')
    .update(Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8'))
    .digest('hex');

export async function loadR1_010D() {
  const [manifest, contract, adr] = await Promise.all([
    readFile(
      resolve(root, 'docs/contracts/R1-010D-frozen-manifest.json'),
      'utf8',
    ).then(JSON.parse),
    readFile(
      resolve(root, 'docs/contracts/R1-010D-malware-scan-contract.md'),
      'utf8',
    ),
    readFile(resolve(root, 'docs/adr/ADR-005-malware-scanning.md'), 'utf8'),
  ]);
  const actualHashes = {
    'docs/adr/ADR-005-malware-scanning.md': sha256(adr),
    'docs/contracts/R1-010D-malware-scan-contract.md': sha256(contract),
  };
  const actualApprovedSourceHashes = Object.fromEntries(
    Object.entries(approvedSourceArtifacts).map(([path]) => {
      const source = execFileSync(
        'git',
        ['show', `${manifest.approval.sourceHead}:${path}`],
        { cwd: root, maxBuffer: 5 * 1024 * 1024 },
      ).toString('utf8');
      return [path, sha256(source)];
    }),
  );
  return { manifest, contract, adr, actualHashes, actualApprovedSourceHashes };
}

export function validateR1_010D(c) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (c.manifest.contract !== 'R1-010D Malware Scan Security Contract')
    fail('wrong contract identity');
  if (c.manifest.status !== 'FROZEN' || c.manifest.version !== '1.0.0')
    fail('contract is not FROZEN 1.0.0');
  if (
    c.manifest.approval?.sourceHead !==
    '1cad9fbb210ded32b07cee3923bec8ab011768a8'
  )
    fail('owner approval source HEAD changed');
  if (
    JSON.stringify(c.manifest.approval?.decisionIds) !==
    JSON.stringify(decisions)
  )
    fail('OD-010D-01…05 approval record changed');
  if (c.manifest.approval?.scope?.includes('production migration') !== true)
    fail('production boundary is missing');
  const actualContentHashes = {
    'docs/adr/ADR-005-malware-scanning.md': sha256(c.adr),
    'docs/contracts/R1-010D-malware-scan-contract.md': sha256(c.contract),
  };
  for (const [path, expected] of Object.entries(frozenArtifacts)) {
    if (!/^[a-f0-9]{64}$/.test(expected))
      fail(`checker checksum is not finalized for ${path}`);
    if (c.manifest.frozenArtifactSha256?.[path] !== expected)
      fail(`manifest checksum changed for ${path}`);
    if (c.actualHashes[path] !== expected)
      fail(`frozen artifact content changed: ${path}`);
    if (actualContentHashes[path] !== expected)
      fail(`frozen artifact content changed: ${path}`);
  }
  for (const [path, expected] of Object.entries(approvedSourceArtifacts)) {
    if (c.manifest.approvedSourceSha256?.[path] !== expected)
      fail(`approved source checksum changed for ${path}`);
    if (c.actualApprovedSourceHashes?.[path] !== expected)
      fail(`approval source content changed: ${path}`);
  }
  const required = [
    'ON CONFLICT',
    'QUARANTINED',
    'sourceStorageKey',
    'sourceSha256',
    'sourceSizeBytes',
    'correlationId',
    'StaffUser',
    'signatureSetFingerprint',
    'completedLeaseTokenHash',
    'finalizeFingerprint',
    'SCAN-20',
  ];
  for (const term of required) {
    if (!c.contract.includes(term)) fail(`frozen contract is missing ${term}`);
  }
  for (let i = 1; i <= 20; i++) {
    if (!c.contract.includes(`SCAN-${String(i).padStart(2, '0')}`))
      fail(`SCAN-${String(i).padStart(2, '0')} is missing`);
  }
  if (!c.adr.includes('ACCEPTED') || !c.adr.includes('option B'))
    fail('ADR-005 does not record the accepted architecture');
  assert.equal(errors.length, 0, errors.join('\n'));
  return true;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateR1_010D(await loadR1_010D());
  process.stdout.write('R1-010D FROZEN 1.0.0 contract and checksums: PASS\n');
}
