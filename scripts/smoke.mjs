import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  compose,
  loadLocalEnv,
  requireLocalDocker,
  requireFreePort,
  reportFailure,
  root,
} from './lib.mjs';
import { composeUp, infraUp } from './ops.mjs';
import { withHostApps } from './host-apps.mjs';

const mode = process.argv[2];

async function request(service, endpoint, signal) {
  if (service === 'ingestion' && mode === 'compose') {
    const code = [
      'import json,urllib.request,urllib.error',
      `url='http://127.0.0.1:8000${endpoint}'`,
      'try:',
      ' r=urllib.request.urlopen(url,timeout=8)',
      'except urllib.error.HTTPError as e:',
      ' r=e',
      "print(json.dumps({'code':r.code,'body':json.loads(r.read())}))",
    ].join('\n');
    return JSON.parse(
      await compose(['exec', '-T', 'ingestion', 'python', '-c', code], {
        capture: true,
      }),
    );
  }
  const ports = { web: 3000, api: 3001, ingestion: 8000 };
  const response = await fetch(
    `http://127.0.0.1:${ports[service]}${endpoint}`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
      cache: 'no-store',
    },
  );
  return { code: response.status, body: await response.json() };
}

async function waitReady(signal) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    signal?.throwIfAborted();
    try {
      const responses = await Promise.all(
        ['api', 'web', 'ingestion'].map((service) =>
          request(service, '/health/ready', signal),
        ),
      );
      if (
        responses.every(
          (response) =>
            response.code === 200 && response.body.status === 'ready',
        )
      )
        return;
    } catch {
      signal?.throwIfAborted();
      /* Services may still be starting. */
    }
    await delay(750, undefined, { signal });
  }
  throw new Error('Services did not become ready within 120 seconds.');
}

async function checkReady(signal) {
  await waitReady(signal);
  const api = await request('api', '/health/ready', signal);
  assert.deepEqual(api.body.checks, { postgres: 'up', redis: 'up' });
  const page = await fetch('http://127.0.0.1:3000', {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /STDU SHOP/);
  for (const service of ['api', 'web', 'ingestion']) {
    const response = await request(service, '/health/live', signal);
    assert.equal(response.code, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  }
  console.log(
    `PASS ${mode}: web page + all liveness/readiness; real PostgreSQL SELECT 1 and Redis PING`,
  );
}

async function outage(dependency, signal) {
  console.log(`Checking ${dependency} outage in the local ${mode} project...`);
  await compose(['stop', dependency]);
  try {
    const api = await request('api', '/health/ready', signal);
    assert.equal(api.code, 503);
    assert.equal(api.body.status, 'not_ready');
    assert.equal(api.body.checks[dependency], 'down');
    const other = dependency === 'redis' ? 'postgres' : 'redis';
    assert.equal(api.body.checks[other], 'up');
    for (const service of ['api', 'web', 'ingestion']) {
      const ready = await request(service, '/health/ready', signal);
      assert.equal(ready.code, 503, `${service} must refuse readiness`);
      const live = await request(service, '/health/live', signal);
      assert.equal(live.code, 200, `${service} must remain live`);
      const encoded = JSON.stringify(ready.body);
      for (const key of [
        'POSTGRES_PASSWORD',
        'REDIS_PASSWORD',
        'DATABASE_URL',
        'REDIS_URL',
      ]) {
        assert.ok(
          !encoded.includes(process.env[key]),
          'Readiness leaked a secret',
        );
      }
    }
    console.log(
      `PASS ${dependency}: API/web/ingestion readiness 503, liveness 200, no secret leakage`,
    );
  } finally {
    // Restore this task's dependency; never remove containers, volumes or data.
    await compose(['start', dependency]);
    await waitReady(signal);
  }
}

async function main() {
  loadLocalEnv();
  await requireLocalDocker();
  if (mode === 'compose') {
    await composeUp();
    await checks();
  } else if (mode === 'host') {
    for (const port of [3000, 3001, 8000]) await requireFreePort(port);
    await infraUp();
    // Start built Node apps and the locked Python venv directly, without
    // shell/pnpm/uv/watch/reload intermediaries in the test lifecycle.
    if (
      !existsSync(resolve(root, 'apps/web/.next/BUILD_ID')) ||
      !existsSync(resolve(root, 'apps/api/dist/main.js'))
    )
      throw new Error('Host smoke requires built apps. Run pnpm build first.');
    await withHostApps(checks, { smoke: true });
    for (const port of [3000, 3001, 8000]) await requireFreePort(port);
  } else {
    throw new Error('Smoke mode must be compose or host.');
  }
  console.log(
    `PASS ${mode} infrastructure smoke completed; ${mode === 'host' ? 'shutdown verified; ' : ''}dependencies restored; volumes preserved.`,
  );
}

async function checks(signal) {
  await checkReady(signal);
  await outage('postgres', signal);
  await outage('redis', signal);
  await checkReady(signal);
}

main().catch(reportFailure);
