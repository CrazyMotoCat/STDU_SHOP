import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validSha } from './classify-changes.mjs';

export function verifyFullGate({
  plan,
  planResult,
  fullResult,
  actualSha,
  livePr,
  mainSha,
  dispatchSha,
}) {
  assert.equal(planResult, 'success', 'classification job must succeed');
  assert.equal(
    fullResult,
    'success',
    'FULL must execute and succeed; skipped/neutral is not acceptance',
  );
  assert.equal(plan?.version, 1);
  assert.equal(plan.full, true, 'FAST-only Draft is not merge-ready');
  assert(validSha(plan.testedSha) && validSha(plan.headSha));
  assert.equal(actualSha, plan.testedSha, 'tested checkout must match plan');
  if (plan.eventName === 'pull_request') {
    assert(livePr && livePr.state === 'open', 'live PR must be open');
    assert.equal(
      livePr.head.sha,
      plan.headSha,
      'new HEAD invalidates old FULL',
    );
    assert.equal(
      livePr.base.sha,
      plan.baseSha,
      'base advancement requires fresh FULL',
    );
    assert.equal(mainSha, plan.baseSha, 'target branch advanced');
    assert.equal(
      livePr.merge_commit_sha,
      plan.testedSha,
      'merge candidate changed',
    );
    assert.equal(livePr.mergeable, true, 'candidate must be mergeable');
  } else if (plan.eventName === 'push') {
    assert.equal(
      mainSha,
      plan.testedSha,
      'post-merge acceptance belongs to this main SHA',
    );
  } else if (plan.eventName === 'workflow_dispatch') {
    assert.equal(
      dispatchSha,
      plan.testedSha,
      'selected ref advanced after dispatch',
    );
  } else assert.equal(plan.eventName, 'merge_group');
  return true;
}

export function verifyFastGate(results) {
  assert.deepEqual(Object.keys(results).sort(), [
    'contracts',
    'javascript',
    'python',
  ]);
  for (const result of Object.values(results)) assert.equal(result, 'success');
  return true;
}

async function getJson(path, env) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub identity verification failed: HTTP ${response.status}`,
    );
  return response.json();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  if (process.argv.includes('--fast')) {
    verifyFastGate(JSON.parse(env.FAST_RESULTS));
  } else {
    const plan = JSON.parse(env.PLAN_JSON);
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    let livePr;
    let mainSha;
    let dispatchSha;
    if (plan.eventName === 'pull_request') {
      livePr = await getJson(`pulls/${event.number}`, env);
      const target = await getJson(`git/ref/heads/${livePr.base.ref}`, env);
      mainSha = target.object.sha;
    }
    if (plan.eventName === 'push') mainSha = env.GITHUB_SHA;
    if (plan.eventName === 'workflow_dispatch') {
      const ref = await getJson(
        `git/ref/${env.GITHUB_REF.replace(/^refs\//, '')}`,
        env,
      );
      dispatchSha = ref.object.sha;
    }
    verifyFullGate({
      plan,
      planResult: env.PLAN_RESULT,
      fullResult: env.FULL_RESULT,
      actualSha,
      livePr,
      mainSha,
      dispatchSha,
    });
  }
  console.log('PASS exact-revision CI gate');
}
