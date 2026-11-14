import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createPlan } from './classify-changes.mjs';

test('real Git merge-base diff uses only PR changes and includes deleted/renamed paths', () => {
  const originalCwd = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'stdu-ci-classifier-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Synthetic CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'guide.md'), 'original\n');
    git('add', '.');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'feature');
    writeFileSync(join(root, 'docs', 'guide.md'), 'edited\n');
    git('commit', '-qam', 'docs-only');
    const head = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    writeFileSync(join(root, 'new-critical-file'), 'upstream-only\n');
    git('add', '.');
    git('commit', '-qm', 'main advancement');
    const advancedBase = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'feature');
    const eventPath = join(root, 'event.json');
    const event = {
      action: 'synchronize',
      pull_request: {
        draft: true,
        head: { sha: head },
        base: { sha: advancedBase },
      },
    };
    writeFileSync(eventPath, JSON.stringify(event));
    process.chdir(root);
    const env = {
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: head,
      GITHUB_EVENT_NAME: 'pull_request',
    };
    assert.equal(
      createPlan(env).full,
      false,
      'unrelated main-only path must not pollute PR diff',
    );
    git('mv', 'docs/guide.md', 'docs/new-name.md');
    git('commit', '-qm', 'rename');
    const renamedHead = git('rev-parse', 'HEAD');
    event.pull_request.head.sha = renamedHead;
    writeFileSync(eventPath, JSON.stringify(event));
    assert.equal(createPlan({ ...env, GITHUB_SHA: renamedHead }).full, true);
    event.pull_request.base.sha = 'd'.repeat(40);
    writeFileSync(eventPath, JSON.stringify(event));
    assert.equal(
      createPlan({ ...env, GITHUB_SHA: renamedHead }).full,
      true,
      'missing Git ref must force FULL',
    );
    assert.throws(() => createPlan({ ...env, GITHUB_SHA: base }));
    assert(readFileSync(eventPath, 'utf8').includes(renamedHead));
  } finally {
    process.chdir(originalCwd);
    assert(
      resolve(root).startsWith(resolve(tmpdir()) + '\\') ||
        resolve(root).startsWith(resolve(tmpdir()) + '/'),
    );
    rmSync(root, { recursive: true, force: true });
  }
});
