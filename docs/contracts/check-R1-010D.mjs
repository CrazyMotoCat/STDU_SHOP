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
    'b720782c178b467563025978da9317893f2965dda129a6a972a99798278272f9',
  'docs/contracts/R1-010D-malware-scan-contract.md':
    '38c038a7b978b2dcaec95cef697cd4a763e4eb70b598304510d2ba921d071815',
};
const decisions = [
  'OD-010D-01',
  'OD-010D-02',
  'OD-010D-03',
  'OD-010D-04',
  'OD-010D-05',
];
const contractVersion = '1.0.1';
const l0ApprovalHead = '1be16abdb4732086cb2f721ab0f6eeae4e21c9a4';
const l0SourceArtifact =
  'docs/plans/R1-010D-L0-implementation-amendment-draft.md';
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
  const actualL0SourceSha256 = sha256(
    execFileSync('git', ['show', `${l0ApprovalHead}:${l0SourceArtifact}`], {
      cwd: root,
      maxBuffer: 5 * 1024 * 1024,
    }).toString('utf8'),
  );
  return {
    manifest,
    contract,
    adr,
    actualHashes,
    actualApprovedSourceHashes,
    actualL0SourceSha256,
  };
}

export function validateR1_010D(c) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (c.manifest.contract !== 'R1-010D Malware Scan Security Contract')
    fail('wrong contract identity');
  if (c.manifest.status !== 'FROZEN' || c.manifest.version !== contractVersion)
    fail(`contract is not FROZEN ${contractVersion}`);
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
  if (
    c.manifest.approval.scope !==
    'Authorizes isolated Stage B implementation and testing only. No production migration, deployment, real-document processing, production operator retry, public launch or production permission provisioning. Existing FROZEN R1-010 1.0.2 and decisions 1–108 remain unchanged.'
  )
    fail(
      'original R1-010D owner approval scope must remain historically unchanged',
    );
  const l0Amendment = c.manifest.amendments?.find(
    (amendment) => amendment.id === 'R1-010D Contract Amendment 01',
  );
  if (
    !l0Amendment ||
    l0Amendment.version !== contractVersion ||
    l0Amendment.sourceHead !== l0ApprovalHead ||
    l0Amendment.approvedOn !== '2026-11-02' ||
    l0Amendment.approvedSourceSha256 !== c.actualL0SourceSha256 ||
    !l0Amendment.rule?.includes('CLEAN alone never authorizes download') ||
    !l0Amendment.rule?.includes('before opening private storage')
  )
    fail('R1-010D L0 owner-approved amendment provenance or policy changed');
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
  if (
    !c.contract.includes('CLEAN alone never authorizes download') ||
    !c.contract.includes('including historical CLEAN') ||
    !c.contract.includes('No successful-download AuditEvent is created') ||
    !c.contract.includes('SCAN-21') ||
    !c.adr.includes('Scanner state CLEAN records a scan result only') ||
    !c.adr.includes('before storage open')
  )
    fail(
      'R1-010D CLEAN finalization must remain separate from staff download eligibility',
    );
  for (let i = 1; i <= 21; i++) {
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
  process.stdout.write(
    `R1-010D FROZEN ${contractVersion} contract and checksums: PASS\n`,
  );
}
