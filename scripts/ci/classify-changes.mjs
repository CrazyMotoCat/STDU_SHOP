import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
export function validSha(value) {
  return typeof value === 'string' && shaPattern.test(value);
}

export function classifyChanges(changes, diffError = false) {
  const areas = new Set();
  const reasons = [];
  if (diffError || !Array.isArray(changes) || changes.length === 0)
    return {
      full: true,
      areas: ['all'],
      reasons: ['diff unavailable or empty'],
    };
  for (const change of changes) {
    if (!['A', 'M', 'D', 'R', 'C', 'T'].includes(change.status)) {
      reasons.push('unknown change status');
      areas.add('all');
    }
    if (['D', 'R', 'C', 'T'].includes(change.status))
      reasons.push('deletion, rename, copy or type change');
    const paths = [change.oldPath, change.path].filter(Boolean);
    if (paths.length === 0) reasons.push('missing path');
    for (const path of paths) {
      if (
        typeof path !== 'string' ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').some((part) => part === '..' || part === '')
      ) {
        areas.add('all');
        reasons.push('invalid path');
      } else if (
        path.startsWith('docs/contracts/') ||
        path.startsWith('docs/spec/') ||
        path.startsWith('docs/adr/') ||
        path.startsWith('.github/') ||
        path.startsWith('scripts/') ||
        path.startsWith('infra/') ||
        path.startsWith('packages/') ||
        path.startsWith('apps/api/') ||
        path.startsWith('services/ingestion/src/') ||
        /(^|\/)(package\.json|pnpm-lock\.yaml|uv\.lock|Dockerfile|.*config\.[^/]+|AGENTS\.md|toolchain\.json|\.node-version|\.python-version)$/.test(
          path,
        )
      ) {
        areas.add('all');
        reasons.push(
          'critical configuration, contract, backend or file ingestion',
        );
      } else if (path.startsWith('services/ingestion/tests/')) {
        areas.add('parser');
      } else if (path.startsWith('apps/web/src/app/staff/suppliers/')) {
        // Session, CSRF and idempotency live here: never classify as simple UI.
        areas.add('supplier');
        reasons.push('staff supplier mutation/session UI');
      } else if (path.startsWith('apps/web/src/app/staff/')) {
        areas.add('all');
        reasons.push('staff authorization or mutation UI');
      } else if (path.startsWith('apps/web/src/components/catalog/')) {
        areas.add('frontend');
        areas.add('catalog');
      } else if (/^(apps\/web\/src\/app\/(catalog|products)\/)/.test(path)) {
        areas.add('frontend');
        areas.add('catalog');
      } else if (
        [
          'apps/web/src/app/page.tsx',
          'apps/web/src/app/page.module.css',
          'apps/web/src/app/globals.css',
        ].includes(path)
      ) {
        areas.add('frontend');
      } else if (
        (path.startsWith('docs/') || path.startsWith('.agent/tasks/')) &&
        /\.(md|txt)$/.test(path)
      ) {
        areas.add('docs');
      } else if (['README.md', 'README_START_HERE.md'].includes(path)) {
        areas.add('docs');
      } else {
        areas.add('all');
        reasons.push('unknown or shared path');
      }
    }
  }
  return {
    full: reasons.length > 0,
    areas: [...areas].sort(),
    reasons: [...new Set(reasons)],
  };
}

export function parseNameStatus(raw) {
  if (typeof raw !== 'string' || !raw.endsWith('\0'))
    throw new Error('incomplete diff');
  const fields = raw.slice(0, -1).split('\0');
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const code = fields[index++];
    if (!/^(A|M|D|T|R\d{1,3}|C\d{1,3})$/.test(code))
      throw new Error('invalid status');
    const first = fields[index++];
    if (!first) throw new Error('missing diff path');
    if (/^[RC]/.test(code)) {
      const second = fields[index++];
      if (!second) throw new Error('missing rename destination');
      changes.push({ status: code[0], oldPath: first, path: second });
    } else changes.push({ status: code, path: first });
  }
  return changes;
}

export function planRun({ eventName, event = {}, testedSha, classification }) {
  if (!validSha(testedSha)) throw new Error('invalid tested SHA');
  const pr = event.pull_request;
  let headSha = testedSha;
  let baseSha = '';
  let full = true;
  if (eventName === 'pull_request') {
    if (!pr || !validSha(pr.head?.sha) || !validSha(pr.base?.sha))
      throw new Error('invalid PR identity');
    headSha = pr.head.sha;
    baseSha = pr.base.sha;
    full =
      pr.draft !== true ||
      event.action === 'ready_for_review' ||
      classification.full;
  } else if (eventName === 'workflow_dispatch') {
    if (
      !validSha(event.inputs?.expected_sha) ||
      event.inputs.expected_sha !== testedSha
    )
      throw new Error('dispatch must match the selected ref SHA');
  } else if (eventName !== 'push' && eventName !== 'merge_group') {
    throw new Error('unsupported CI event');
  }
  return {
    version: 1,
    eventName,
    testedSha,
    headSha,
    baseSha,
    full,
    classification,
  };
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function createPlan(env = process.env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const testedSha = git('rev-parse', 'HEAD').trim();
  if (testedSha !== env.GITHUB_SHA)
    throw new Error('checkout differs from event SHA');
  let classification;
  try {
    const pr = event.pull_request;
    const base = pr?.base?.sha ?? event.before;
    const head = pr?.head?.sha ?? testedSha;
    if (!validSha(base) || !validSha(head))
      throw new Error('missing diff refs');
    const mergeBase = git('merge-base', base, head).trim();
    classification = classifyChanges(
      parseNameStatus(
        git('diff', '--name-status', '-z', '--find-renames', mergeBase, head),
      ),
    );
  } catch {
    classification = classifyChanges([], true);
  }
  return planRun({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    testedSha,
    classification,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = createPlan();
  mkdirSync('.local/ci', { recursive: true });
  writeFileSync('.local/ci/plan.json', JSON.stringify(plan, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `full=${plan.full}\nhead=${plan.headSha}\nbase=${plan.baseSha}\ntested=${plan.testedSha}\njson=${JSON.stringify(plan)}\n`,
    );
  console.log(JSON.stringify(plan));
}
