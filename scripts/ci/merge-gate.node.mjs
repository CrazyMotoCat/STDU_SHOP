import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyFullGate, verifyFastGate } from './merge-gate.mjs';
const head = 'a'.repeat(40),
  base = 'b'.repeat(40),
  merge = 'c'.repeat(40);
const args = () => ({
  plan: {
    version: 1,
    eventName: 'pull_request',
    full: true,
    testedSha: merge,
    headSha: head,
    baseSha: base,
  },
  planResult: 'success',
  fullResult: 'success',
  actualSha: merge,
  mainSha: base,
  livePr: {
    state: 'open',
    mergeable: true,
    head: { sha: head },
    base: { sha: base },
    merge_commit_sha: merge,
  },
});
test('only successful FULL and exact live revision pass', () =>
  assert(verifyFullGate(args())));
for (const state of [
  'skipped',
  'neutral',
  'cancelled',
  'failure',
  '',
  undefined,
]) {
  test(`FULL ${state} cannot pass gate`, () =>
    assert.throws(() => verifyFullGate({ ...args(), fullResult: state })));
  test(`planner ${state} cannot pass gate`, () =>
    assert.throws(() => verifyFullGate({ ...args(), planResult: state })));
}
test('FAST success plus absent FULL never authorizes merge', () => {
  assert(
    verifyFastGate({
      javascript: 'success',
      python: 'success',
      contracts: 'success',
    }),
  );
  assert.throws(() =>
    verifyFullGate({
      ...args(),
      plan: { ...args().plan, full: false },
      fullResult: 'skipped',
    }),
  );
});
for (const field of ['head', 'base', 'merge_commit_sha', 'mergeable', 'state'])
  test(`live ${field} change invalidates FULL`, () => {
    const value = {
      head: { sha: base },
      base: { sha: head },
      merge_commit_sha: head,
      mergeable: null,
      state: 'closed',
    }[field];
    assert.throws(() =>
      verifyFullGate({
        ...args(),
        livePr: { ...args().livePr, [field]: value },
      }),
    );
  });
test('missing API result, changed target branch and wrong checkout fail closed', () => {
  assert.throws(() => verifyFullGate({ ...args(), livePr: null }));
  assert.throws(() => verifyFullGate({ ...args(), mainSha: head }));
  assert.throws(() => verifyFullGate({ ...args(), actualSha: head }));
});
test('manual stale ref cannot claim its old FULL covers a new revision', () => {
  const manual = {
    ...args(),
    plan: { ...args().plan, eventName: 'workflow_dispatch' },
    dispatchSha: merge,
  };
  assert(verifyFullGate(manual));
  assert.throws(() => verifyFullGate({ ...manual, dispatchSha: head }));
});
test('every FAST component must execute and succeed', () => {
  for (const state of ['skipped', 'failure', 'cancelled', undefined])
    assert.throws(() =>
      verifyFastGate({
        javascript: 'success',
        python: state,
        contracts: 'success',
      }),
    );
  assert.throws(() => verifyFastGate({ javascript: 'success' }));
});
