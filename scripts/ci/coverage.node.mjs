import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkAddedLines } from './hygiene.mjs';
const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );
const original = read('docs/ci/legacy-ci.yml.txt');
const legacy = read('.github/workflows/ci.yml');
const full = read('.github/workflows/ci-full.yml');

test('legacy coverage unchanged apart from safe main concurrency isolation', () => {
  assert.equal(
    legacy
      .replace(
        "foundation-${{ github.event_name == 'push' && github.run_id || github.ref }}",
        'foundation-${{ github.ref }}',
      )
      .replace(
        "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        'cancel-in-progress: true',
      ),
    original,
  );
});
test('FULL retains every original step in order, including commands, env, cleanup', () => {
  const originalSteps = original.slice(original.indexOf('    steps:'));
  const newSteps = full.slice(
    full.indexOf('    steps:', full.indexOf('\n  full:')),
    full.indexOf('\n  merge-gate:'),
  );
  const normalized = newSteps
    .replace(
      '          ref: ${{ github.sha }}\n          persist-credentials: false\n',
      '',
    )
    .replace(
      / {6}- name: CI policy tests and diff hygiene\n[\s\S]*?(?= {6}- run: pnpm toolchain:check)/,
      '',
    );
  assert.equal(normalized.trimEnd(), originalSteps.trimEnd());
});
test('gate always runs, explicit required success and main groups are unique', () => {
  assert(full.includes('if: ${{ always() }}\n    needs: [plan, full]'));
  assert(full.includes('github.event.pull_request.number || github.run_id'));
  assert(
    full.includes(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    ),
  );
  assert(!full.includes('pull_request_target'));
  assert(!full.includes('paths-ignore:'));
  for (const event of [
    'ready_for_review',
    'synchronize',
    'converted_to_draft',
    'edited',
    'workflow_dispatch',
    'merge_group',
  ])
    assert(full.includes(event));
});
test('limited added-line scanner detects signatures without disclosing data', () => {
  checkAddedLines('+const token = process.env.GITHUB_TOKEN;');
  assert.throws(() => checkAddedLines('+-----BEGIN ' + 'PRIVATE KEY-----'));
  assert.throws(() => checkAddedLines('+gh' + 'p_' + 'a'.repeat(36)));
  checkAddedLines('-gh' + 'p_' + 'a'.repeat(36));
});

test('manual FULL cannot emit the PR required merge-gate context', () => {
  assert(
    full.includes(
      "name: ${{ github.event_name == 'workflow_dispatch' && 'Supplemental FULL evidence' || 'FULL merge gate' }}",
    ),
  );
});

test('FAST contract bundle retains every original contract and lock command', () => {
  const block = original.slice(
    original.indexOf('      - name: Frozen R1-002'),
    original.indexOf('      - name: R1-004B isolated schema'),
  );
  const commands = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('        run: ') && !line.endsWith('|'))
      commands.push(line.slice(13));
    else if (line.startsWith('          ')) commands.push(line.slice(10));
  }
  const fastCommands = read('scripts/ci/contracts.sh')
    .split('\n')
    .slice(2)
    .join('\n')
    .trimEnd();
  assert.equal(fastCommands, commands.join('\n'));
});
