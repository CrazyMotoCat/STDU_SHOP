import test from 'node:test';
import assert from 'node:assert/strict';
import { loadR1_010D, validateR1_010D } from './check-R1-010D.mjs';

const baseline = await loadR1_010D();

test('R1-010D frozen contract, approval provenance and checksums agree', () => {
  assert.doesNotThrow(() => validateR1_010D(baseline));
  assert.equal(baseline.manifest.version, '1.0.1');
  const amendment = baseline.manifest.amendments.find(
    (entry) => entry.id === 'R1-010D Contract Amendment 01',
  );
  assert.equal(
    amendment.sourceHead,
    '1be16abdb4732086cb2f721ab0f6eeae4e21c9a4',
  );
  assert.match(amendment.rule, /CLEAN alone never authorizes download/);
});

test('L0 preserves scan finalization but denies every staff download before storage', () => {
  assert.match(baseline.contract, /successful scan may continue to set/);
  assert.match(baseline.contract, /including historical CLEAN/);
  assert.match(
    baseline.contract,
    /No successful-download AuditEvent is created/,
  );
  assert.match(
    baseline.contract,
    /private lease-bound scanner stream is not a staff download/,
  );
  assert.match(baseline.contract, /SCAN-21/);
});

test('checker rejects drift in the frozen contract checksum', () => {
  const changed = structuredClone(baseline);
  changed.contract += '\nUnapproved change.\n';
  assert.throws(
    () => validateR1_010D(changed),
    /frozen artifact content changed/,
  );
});

test('checker requires the transaction-safe legacy quarantine backfill', () => {
  const changed = structuredClone(baseline);
  changed.contract = changed.contract.replaceAll('ON CONFLICT', 'ONCONFLICT');
  assert.throws(
    () => validateR1_010D(changed),
    /frozen artifact content changed|missing ON CONFLICT/,
  );
});

test('checker requires controlled operator retry correlation and test-only boundary', () => {
  const changed = structuredClone(baseline);
  changed.contract = changed.contract.replaceAll(
    'correlationId',
    'operatorNote',
  );
  assert.throws(
    () => validateR1_010D(changed),
    /frozen artifact content changed|missing correlationId/,
  );
});

test('checker requires start/finalize signature attestation and exact replay fencing', () => {
  const changed = structuredClone(baseline);
  changed.contract = changed.contract.replaceAll(
    'finalizeFingerprint',
    'result',
  );
  assert.throws(
    () => validateR1_010D(changed),
    /frozen artifact content changed|missing finalizeFingerprint/,
  );
});

test('checker binds exactly the approved OD-010D decision set and source SHA', () => {
  const changed = structuredClone(baseline);
  changed.manifest.approval.sourceHead = '0'.repeat(40);
  assert.throws(
    () => validateR1_010D(changed),
    /owner approval source HEAD changed/,
  );
});
