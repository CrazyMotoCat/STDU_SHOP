import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyChanges,
  parseNameStatus,
  planRun,
} from './classify-changes.mjs';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const merge = 'c'.repeat(40);
const modify = (path) => [{ status: 'M', path }];

for (const [path, area] of [
  ['docs/ci/README.md', 'docs'],
  ['.agent/tasks/CI-OPT-01/state.md', 'docs'],
  ['apps/web/src/app/globals.css', 'frontend'],
  ['apps/web/src/components/catalog/catalog-ui.tsx', 'catalog'],
  ['services/ingestion/tests/test_health.py', 'parser'],
])
  test(`known FAST path ${path}`, () => {
    const result = classifyChanges(modify(path));
    assert.equal(result.full, false);
    assert(result.areas.includes(area));
  });

for (const path of [
  '.github/workflows/ci-full.yml',
  '.github/actions/ci-setup/action.yml',
  'scripts/ci/classify-changes.mjs',
  'scripts/ci/merge-gate.mjs',
  'apps/api/src/identity/auth.service.ts',
  'apps/api/prisma/migrations/new.sql',
  'apps/api/src/files/storage.ts',
  'docs/contracts/new.json',
  'packages/staff-client/src/schema.d.ts',
  'infra/compose/a.yaml',
  'pnpm-lock.yaml',
  'package.json',
  'services/ingestion/uv.lock',
  'services/ingestion/src/ingestion/catalog_import_parser.py',
  'apps/web/src/app/staff/suppliers/workspace.tsx',
  'apps/web/src/components/shared.tsx',
  'unknown/new.md',
  'AGENTS.md',
])
  test(`critical or unknown path ${path}`, () =>
    assert.equal(classifyChanges(modify(path)).full, true));

for (const status of ['D', 'T', 'R', 'C'])
  test(`all ${status} changes force FULL`, () => {
    assert.equal(
      classifyChanges([
        { status, path: 'README.md', oldPath: '.github/workflows/ci.yml' },
      ]).full,
      true,
    );
  });

test('rename examines both paths, including safe destination', () => {
  for (const [oldPath, path] of [
    ['README.md', 'apps/api/src/file.ts'],
    ['apps/api/src/file.ts', 'README.md'],
  ])
    assert.equal(classifyChanges([{ status: 'R', oldPath, path }]).full, true);
});

test('unknown status, invalid path, empty or unavailable diff fail closed', () => {
  for (const changes of [
    [],
    null,
    [{ status: 'X', path: 'README.md' }],
    [{ status: 'M', path: '../README.md' }],
    [{ status: 'M' }],
  ])
    assert.equal(classifyChanges(changes).full, true);
  assert.equal(classifyChanges(modify('README.md'), true).full, true);
});

test('NUL parser preserves whitespace, newlines, Unicode and rename sources', () => {
  assert.deepEqual(
    parseNameStatus(
      'M\0docs/a\nb.md\0R100\0old name\0новое имя\0D\0README.md\0',
    ),
    [
      { status: 'M', path: 'docs/a\nb.md' },
      { status: 'R', oldPath: 'old name', path: 'новое имя' },
      { status: 'D', path: 'README.md' },
    ],
  );
});
for (const raw of [
  '',
  'M\0missing terminator',
  'R100\0one\0',
  'X\0README.md\0',
  'M\0\0',
])
  test(`reject malformed diff ${JSON.stringify(raw)}`, () =>
    assert.throws(() => parseNameStatus(raw)));

test('Draft docs uses FAST, Ready and subsequent pushes force FULL independent of labels/title', () => {
  const event = {
    action: 'synchronize',
    pull_request: {
      draft: true,
      head: { sha: head },
      base: { sha: base },
      title: 'skip full',
      labels: [{ name: 'skip-ci' }],
    },
  };
  const args = {
    eventName: 'pull_request',
    event,
    testedSha: merge,
    classification: classifyChanges(modify('README.md')),
  };
  assert.equal(planRun(args).full, false);
  assert.equal(
    planRun({ ...args, event: { ...event, action: 'ready_for_review' } }).full,
    true,
  );
  assert.equal(
    planRun({
      ...args,
      event: {
        ...event,
        pull_request: { ...event.pull_request, draft: false },
      },
    }).full,
    true,
  );
  assert.equal(
    planRun({ ...args, classification: classifyChanges([], true) }).full,
    true,
  );
});

test('main, merge queue and exact manual revision always run FULL', () => {
  for (const eventName of ['push', 'merge_group', 'workflow_dispatch'])
    assert.equal(
      planRun({
        eventName,
        event: { inputs: { expected_sha: head } },
        testedSha: head,
        classification: classifyChanges(modify('README.md')),
      }).full,
      true,
    );
  assert.throws(() =>
    planRun({
      eventName: 'workflow_dispatch',
      event: { inputs: { expected_sha: base } },
      testedSha: head,
      classification: {},
    }),
  );
  assert.throws(() =>
    planRun({
      eventName: 'workflow_dispatch',
      event: { inputs: { expected_sha: 'main' } },
      testedSha: head,
      classification: {},
    }),
  );
});
