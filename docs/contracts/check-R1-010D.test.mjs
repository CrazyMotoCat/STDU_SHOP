import test from 'node:test';
import assert from 'node:assert/strict';
import { loadR1_010D, validateR1_010D } from './check-R1-010D.mjs';

const baseline = await loadR1_010D();

test('R1-010D frozen contract, approval provenance and checksums agree', () => {
  assert.doesNotThrow(() => validateR1_010D(baseline));
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
