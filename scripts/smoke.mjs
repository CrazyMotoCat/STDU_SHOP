import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  compose,
  loadLocalEnv,
  requireLocalDocker,
  requireFreePort,
  reportFailure,
} from './lib.mjs';
import { composeUp, infraUp } from './ops.mjs';
import { startHostApps } from './host-apps.mjs';

const mode = process.argv[2];
let host;

async function request(service, endpoint) {
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
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    },
  );
  return { code: response.status, body: await response.json() };
}

async function waitReady() {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    try {
      const responses = await Promise.all(
        ['api', 'web', 'ingestion'].map((service) =>
          request(service, '/health/ready'),
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
      /* Services may still be starting. */
    }
    await delay(750);
  }
  throw new Error('Services did not become ready within 120 seconds.');
}

async function checkReady() {
  await waitReady();
  const api = await request('api', '/health/ready');
  assert.deepEqual(api.body.checks, { postgres: 'up', redis: 'up' });
  const page = await fetch('http://127.0.0.1:3000', {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /STDU SHOP/);
  for (const service of ['api', 'web', 'ingestion']) {
    const response = await request(service, '/health/live');
    assert.equal(response.code, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  }
  console.log(
    `PASS ${mode}: web page + all liveness/readiness; real PostgreSQL SELECT 1 and Redis PING`,
  );
}

async function outage(dependency) {
  console.log(`Checking ${dependency} outage in the local ${mode} project...`);
  await compose(['stop', dependency]);
  try {
    const api = await request('api', '/health/ready');
    assert.equal(api.code, 503);
    assert.equal(api.body.status, 'not_ready');
    assert.equal(api.body.checks[dependency], 'down');
    const other = dependency === 'redis' ? 'postgres' : 'redis';
    assert.equal(api.body.checks[other], 'up');
    for (const service of ['api', 'web', 'ingestion']) {
      const ready = await request(service, '/health/ready');
      assert.equal(ready.code, 503, `${service} must refuse readiness`);
      const live = await request(service, '/health/live');
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
    await waitReady();
  }
}

async function main() {
  loadLocalEnv();
  await requireLocalDocker();
  if (mode === 'compose') {
    await composeUp();
  } else if (mode === 'host') {
    for (const port of [3000, 3001, 8000]) await requireFreePort(port);
    await infraUp();
    host = startHostApps();
    host.result.catch(() => undefined);
  } else {
    throw new Error('Smoke mode must be compose or host.');
  }
  try {
    await checkReady();
    await outage('postgres');
    await outage('redis');
    await checkReady();
    console.log(
      `PASS ${mode} infrastructure smoke completed; dependencies restored; volumes preserved.`,
    );
  } finally {
    if (host) {
      for (const command of host.commands) command.kill('SIGTERM');
      await host.result.catch(() => undefined);
    }
  }
}

main().catch(reportFailure);
