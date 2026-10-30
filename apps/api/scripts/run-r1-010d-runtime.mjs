import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = resolve(
  repoRoot,
  'infra/compose/compose.r1-010d-test.yaml',
);
const project = `stdu-r1-010d-test-${process.pid}-${randomUUID().slice(0, 8)}`;
const image = `stdu-r1-010d-api-test:${project}`;
const runnerImage = `stdu-r1-010d-runner-test:${project}`;
const clamavImage = `stdu-r1-010d-clamav-test:${project}`;
const pgPassword = randomBytes(32).toString('base64url');
const runtimePassword = randomBytes(32).toString('base64url');
const workerPassword = randomBytes(32).toString('base64url');
const operatorPassword = randomBytes(32).toString('base64url');
const redisPassword = randomBytes(32).toString('base64url');
const sessionKey = randomBytes(32).toString('hex');
const rateLimitKey = randomBytes(32).toString('hex');
const testRunId = randomUUID();
let networkSubnets;
let apiStreamIp;
let testNetworkProbeIds = [];
let composeEnv;
let composeAttempted = false;
let exitCode = 0;
let resourceSnapshots = [];
let monitorStop = false;
let monitorError;
let postgresContainerId;
let receivedSignal;
const shutdownController = new AbortController();

function requestShutdown(signal) {
  if (receivedSignal) return;
  receivedSignal = signal;
  shutdownController.abort();
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

function ownedSpawn(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
  if (options.input !== undefined) child.stdin.end(options.input);
  const closed = new Promise((resolveClose, rejectClose) => {
    let settled = false;
    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        rejectClose(error);
      }
    });
    child.once('close', (code, signal) => {
      if (!settled) {
        settled = true;
        resolveClose({ code, signal });
      }
    });
  });
  return {
    child,
    closed,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function terminateOwned(info) {
  if (!info.child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill',
      ['/PID', String(info.child.pid), '/T', '/F'],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    const killerClosed = new Promise((resolveClose) => {
      killer.once('close', (code, signal) =>
        resolveClose({ kind: 'closed', code, signal }),
      );
      killer.once('error', (error) => resolveClose({ kind: 'error', error }));
    });
    const killResult = await Promise.race([
      killerClosed,
      delay(10_000).then(() => ({ kind: 'timeout' })),
    ]);
    if (killResult.kind === 'timeout') {
      killer.kill();
      await Promise.race([killerClosed, delay(1000)]);
      throw new Error(
        'Owned Windows process-tree termination exceeded 10 seconds; refusing to report cleanup success.',
      );
    }
    if (killResult.kind === 'error')
      throw new Error(
        `Could not start taskkill for the owned process tree: ${killResult.error.message}`,
      );
    if (killResult.code !== 0) {
      const originalExited = await Promise.race([
        info.closed.then(
          () => true,
          () => true,
        ),
        delay(1000).then(() => false),
      ]);
      if (!originalExited)
        throw new Error(
          `taskkill exited ${killResult.code ?? killResult.signal}; the owned process tree may still be running.`,
        );
    }
  } else {
    try {
      process.kill(-info.child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  const originalClosed = await Promise.race([
    info.closed.then(
      () => true,
      () => true,
    ),
    delay(5000).then(() => false),
  ]);
  if (!originalClosed)
    throw new Error(
      'The owned process did not close within five seconds after termination.',
    );
}

async function run(command, args, options = {}) {
  if (!options.ignoreInterrupt && shutdownController.signal.aborted)
    throw new Error(`Interrupted by ${receivedSignal ?? 'a shutdown signal'}.`);
  const info = ownedSpawn(command, args, options);
  const timeoutMs = options.timeoutMs ?? 180_000;
  let timer;
  let onAbort;
  const interruption = options.ignoreInterrupt
    ? new Promise(() => {})
    : new Promise((resolveInterruption) => {
        onAbort = () => resolveInterruption({ kind: 'interrupted' });
        shutdownController.signal.addEventListener('abort', onAbort, {
          once: true,
        });
        if (shutdownController.signal.aborted) onAbort();
      });
  const outcome = await Promise.race([
    info.closed.then((result) => ({ kind: 'closed', result })),
    new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout({ kind: 'timeout' }), timeoutMs);
    }),
    interruption,
  ]).finally(() => {
    clearTimeout(timer);
    if (onAbort)
      shutdownController.signal.removeEventListener('abort', onAbort);
  });
  if (outcome.kind === 'interrupted') {
    await terminateOwned(info);
    throw new Error(`Interrupted by ${receivedSignal ?? 'a shutdown signal'}.`);
  }
  if (outcome.kind === 'timeout') {
    await terminateOwned(info);
    throw new Error(
      `${command} exceeded ${timeoutMs}ms; only its owned process tree was terminated.`,
    );
  }
  if (outcome.result.code === 0) return info.stdout.trim();
  throw new Error(
    `${command} exited ${outcome.result.code ?? outcome.result.signal}:\n${`${info.stdout}\n${info.stderr}`.slice(-16000)}`,
  );
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return undefined;
  return parts.reduce((value, part) => value * 256 + part, 0);
}

function ipv4Text(value) {
  return [24, 16, 8, 0]
    .map((shift) => Math.floor(value / 2 ** shift) % 256)
    .join('.');
}

function cidrRange(value) {
  const [address, prefixText] = value.split('/');
  const ip = ipv4Number(address ?? '');
  const prefix = Number(prefixText);
  if (
    ip === undefined ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  )
    return undefined;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ip / size) * size;
  return { start, end: start + size - 1 };
}

async function reserveDockerSubnet(networkName, internal, occupied) {
  const pools = [
    { start: ipv4Number('10.0.0.0'), blocks: 1 << 20 },
    { start: ipv4Number('172.16.0.0'), blocks: 1 << 16 },
    { start: ipv4Number('192.168.0.0'), blocks: 1 << 12 },
  ];
  for (let attempt = 0; attempt < 512; attempt++) {
    const pool = pools[randomBytes(1)[0] % pools.length];
    const block = randomBytes(4).readUInt32BE(0) % pool.blocks;
    const start = pool.start + block * 16;
    const end = start + 15;
    if (occupied.some((range) => start <= range.end && range.start <= end))
      continue;
    const subnet = ipv4Text(start) + '/28';
    const probeName = `${project}-${networkName}-probe-${attempt}`;
    let probeId;
    try {
      const args = [
        'network',
        'create',
        ...(internal ? ['--internal'] : []),
        '--subnet',
        subnet,
        '--label',
        'com.stdu.r1-010d.project=' + project,
        probeName,
      ];
      probeId = (await run('docker', args)).trim();
      testNetworkProbeIds.push(probeId);
      const networks = JSON.parse(
        await run('docker', ['network', 'inspect', probeId]),
      );
      if (
        networks.length !== 1 ||
        networks[0].Labels?.['com.stdu.r1-010d.project'] !== project ||
        networks[0].IPAM?.Config?.[0]?.Subnet !== subnet
      )
        throw new Error(
          `Docker ${networkName} subnet probe ownership or allocation mismatch.`,
        );
      await run('docker', ['network', 'rm', probeId]);
      testNetworkProbeIds = testNetworkProbeIds.filter((id) => id !== probeId);
      occupied.push(cidrRange(subnet));
      return { subnet, address: ipv4Text(start + 2) };
    } catch (error) {
      if (probeId) {
        try {
          await removeOwnedNetworkProbe(probeId);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            `Failed to verify or clean task-owned subnet probe ${probeId}; it remains tracked for final cleanup.`,
            { cause: cleanupError },
          );
        }
      }
      if (/Pool overlaps with other one/i.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error(
    `Could not reserve a non-overlapping Docker subnet for ${networkName}.`,
  );
}

async function removeOwnedNetworkProbe(probeId) {
  let networks;
  try {
    networks = JSON.parse(
      await run('docker', ['network', 'inspect', probeId], {
        ignoreInterrupt: true,
      }),
    );
  } catch (error) {
    if (/no such network/i.test(error.message)) {
      testNetworkProbeIds = testNetworkProbeIds.filter((id) => id !== probeId);
      return;
    }
    throw new Error(
      `Cannot verify ownership of subnet probe ${probeId}: ${error.message}`,
      { cause: error },
    );
  }
  if (
    networks.length !== 1 ||
    networks[0].Labels?.['com.stdu.r1-010d.project'] !== project
  )
    throw new Error(
      `Refusing to remove subnet probe ${probeId} without its task ownership label.`,
    );
  await run('docker', ['network', 'rm', probeId], { ignoreInterrupt: true });
  testNetworkProbeIds = testNetworkProbeIds.filter((id) => id !== probeId);
}

async function reserveDockerNetworks() {
  const ids = (await run('docker', ['network', 'ls', '-q']))
    .split(/\r?\n/)
    .filter(Boolean);
  const inspected = ids.length
    ? JSON.parse(await run('docker', ['network', 'inspect', ...ids]))
    : [];
  const occupied = inspected.flatMap((network) =>
    (network.IPAM?.Config ?? [])
      .map((config) => cidrRange(config.Subnet ?? ''))
      .filter(Boolean),
  );
  const definitions = [
    ['database', true],
    ['application', true],
    ['scanner_internal', true],
    ['scan_stream', true],
    ['signature_egress', false],
    ['clamav_seed', true],
  ];
  const reserved = {};
  for (const [networkName, internal] of definitions) {
    reserved[networkName] = await reserveDockerSubnet(
      networkName,
      internal,
      occupied,
    );
  }
  return reserved;
}

async function compose(args, env = composeEnv, options = {}) {
  return run('docker', ['compose', '-p', project, '-f', composeFile, ...args], {
    env,
    input: options.input,
    ignoreInterrupt: options.ignoreInterrupt,
    timeoutMs: options.timeoutMs,
  });
}

async function runPsql(sql, options = {}) {
  if (!postgresContainerId) {
    const ids = (await compose(['ps', '-q', 'postgres']))
      .split(/\r?\n/)
      .filter(Boolean);
    if (ids.length !== 1)
      throw new Error('Expected exactly one task-owned PostgreSQL container.');
    const inspected = JSON.parse(await run('docker', ['inspect', ids[0]]));
    if (
      inspected.length !== 1 ||
      inspected[0].Config?.Labels?.['com.docker.compose.project'] !== project ||
      inspected[0].Config?.Labels?.['com.docker.compose.service'] !== 'postgres'
    )
      throw new Error(
        'Refusing SQL access to a PostgreSQL container not owned by this task.',
      );
    postgresContainerId = ids[0];
  }
  return run(
    'docker',
    [
      'exec',
      '-i',
      '--user',
      'postgres',
      postgresContainerId,
      'psql',
      '-X',
      '-A',
      '-t',
      '-F',
      '\t',
      '-P',
      'null=__R1_010D_NULL__',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      'stdu_r1_010d_test',
    ],
    {
      input: sql.endsWith('\n') ? sql : sql + '\n',
      timeoutMs: options.timeoutMs ?? 30_000,
    },
  );
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlBytea(value) {
  return `decode('${Buffer.from(value).toString('hex')}', 'hex')`;
}

function parsePsqlRows(output) {
  return output
    ? output
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.split('\t'))
    : [];
}

function parsePsqlValue(value) {
  return value === '__R1_010D_NULL__' ? null : value;
}

async function seedLegacyBackfillFixtures() {
  const inquiryId = randomUUID();
  const publicReference =
    'R1D-' + randomUUID().replaceAll('-', '').slice(0, 20);
  const fixtures = ['QUARANTINED', 'CLEAN', 'REJECTED', 'SCAN_ERROR'].map(
    (safetyState) => ({
      inquiryId,
      intentId: randomUUID(),
      documentId: randomUUID(),
      safetyState,
      sourceKey: createHash('sha256').update(randomUUID()).digest('hex'),
      sourceHash: randomBytes(32),
      sizeBytes: 4096n,
      filename: 'r1-010d-legacy-' + safetyState.toLowerCase() + '.pdf',
    }),
  );
  const statements = [
    'BEGIN;',
    'INSERT INTO inquiry (id,public_reference,kind,status,contact_snapshot,kind_details,upload_profile_code) ' +
      `VALUES (${sqlLiteral(inquiryId)}::uuid,${sqlLiteral(publicReference)},'EQUIPMENT','NEW','{}'::jsonb,'{}'::jsonb,'MVP_SAFE');`,
  ];
  for (const fixture of fixtures) {
    statements.push(
      'INSERT INTO inquiry_upload_intent ' +
        '(id,inquiry_id,state,safe_filename,declared_mime_type,declared_size_bytes,expires_at) ' +
        `VALUES (${sqlLiteral(fixture.intentId)}::uuid,${sqlLiteral(fixture.inquiryId)}::uuid,'ISSUED',${sqlLiteral(fixture.filename)},'application/pdf',${fixture.sizeBytes.toString()},clock_timestamp()+interval '1 hour');`,
    );
  }
  const insertDocument =
    'INSERT INTO inquiry_source_document ' +
    '(id,inquiry_id,upload_intent_id,storage_key,sha256,size_bytes,detected_mime_type,original_filename,safety_state,uploaded_at) ' +
    `VALUES ({{id}}::uuid,{{inquiry}}::uuid,{{intent}}::uuid,{{key}},{{hash}},{{size}},'application/pdf',{{filename}},{{state}},clock_timestamp());`;
  const values = (fixture, state) =>
    insertDocument
      .replace('{{id}}', sqlLiteral(fixture.documentId))
      .replace('{{inquiry}}', sqlLiteral(fixture.inquiryId))
      .replace('{{intent}}', sqlLiteral(fixture.intentId))
      .replace('{{key}}', sqlLiteral(fixture.sourceKey))
      .replace('{{hash}}', sqlBytea(fixture.sourceHash))
      .replace('{{size}}', fixture.sizeBytes.toString())
      .replace('{{filename}}', sqlLiteral(fixture.filename))
      .replace('{{state}}', sqlLiteral(state));
  statements.push(values(fixtures[0], 'QUARANTINED'));
  statements.push(
    'ALTER TABLE inquiry_source_document DISABLE TRIGGER inquiry_source_document_scan_state_guard;',
  );
  for (const fixture of fixtures.slice(1))
    statements.push(values(fixture, fixture.safetyState));
  statements.push(
    'ALTER TABLE inquiry_source_document ENABLE TRIGGER inquiry_source_document_scan_state_guard;',
    'COMMIT;',
  );
  await runPsql(statements.join('\n'));
  return fixtures;
}

async function verifyLegacyBackfill(fixtures) {
  const ids = fixtures
    .map((fixture) => `${sqlLiteral(fixture.documentId)}::uuid`)
    .join(',');
  const rows = parsePsqlRows(
    await runPsql(
      `SELECT d.id::text,d.storage_key,encode(d.sha256,'hex'),d.size_bytes::text,d.safety_state,` +
        `j.source_storage_key,encode(j.source_sha256,'hex'),j.source_size_bytes::text,coalesce(j.status,'__R1_010D_NULL__'),coalesce(j.attempt_count::text,'__R1_010D_NULL__') ` +
        `FROM inquiry_source_document d LEFT JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id ` +
        `WHERE d.id=ANY(ARRAY[${ids}]) ORDER BY d.original_filename;`,
    ),
  );
  if (rows.length !== fixtures.length)
    throw new Error(
      'The actual R1-010D migration did not preserve every legacy fixture.',
    );
  for (const row of rows) {
    const fixture = fixtures.find(
      (candidate) => candidate.documentId === row[0],
    );
    if (!fixture) throw new Error('Unexpected legacy backfill fixture row.');
    if (fixture.safetyState === 'QUARANTINED') {
      if (
        row[8] !== 'PENDING' ||
        Number(row[9]) !== 0 ||
        row[4] !== 'QUARANTINED' ||
        row[1] !== row[5] ||
        row[2] !== row[6] ||
        row[3] !== row[7]
      )
        throw new Error(
          'The actual R1-010D migration backfill copied an unexpected quarantine identity.',
        );
    } else if (parsePsqlValue(row[8]) !== null) {
      throw new Error(
        'The actual R1-010D migration backfilled a terminal source document.',
      );
    }
  }
  await runPsql(
    `UPDATE inquiry_source_document_scan_job SET available_at=clock_timestamp()+interval '1 day' WHERE source_document_id=ANY(ARRAY[${ids}]);`,
  );
  console.log(
    'Actual Prisma migration backfilled only the pre-existing QUARANTINED fixture and excluded terminal sources.',
  );
}

async function verifyReservedScannerRolePreflight() {
  let roleCreated = false;
  try {
    await runPsql('CREATE ROLE stdu_scan_worker NOLOGIN;');
    roleCreated = true;
    await runPsql('GRANT SELECT ON inquiry TO stdu_scan_worker;');
    let rejected = false;
    try {
      const migrationSql = await readFile(
        resolve(
          apiRoot,
          'prisma/migrations/20261028120000_inquiry_scan_jobs/migration.sql',
        ),
        'utf8',
      );
      await runPsql(migrationSql, { timeoutMs: 30_000 });
    } catch (error) {
      if (!/reserved scanner role names must be absent/i.test(error.message))
        throw error;
      rejected = true;
    }

    if (!rejected)
      throw new Error(
        'The migration accepted a pre-existing scanner role with a direct table grant.',
      );
    const state = parsePsqlRows(
      await runPsql(
        `SELECT (to_regclass('public.inquiry_source_document_scan_job') IS NULL)::text,
                EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name='20261028120000_inquiry_scan_jobs')::text,
                has_table_privilege('stdu_scan_worker','public.inquiry','SELECT')::text;`,
      ),
    )[0];
    if (
      state?.[0] !== 'true' ||
      state?.[1] !== 'false' ||
      state?.[2] !== 'true'
    )
      throw new Error(
        `A rejected scanner-role preflight changed migration state or the pre-existing role grant (observed=${JSON.stringify(state)}).`,
      );
    console.log(
      'Actual migration rejected a pre-existing reserved scanner role with an ACL and made no migration changes.',
    );
  } finally {
    if (roleCreated) {
      await runPsql(
        'REVOKE ALL ON inquiry FROM stdu_scan_worker; DROP ROLE stdu_scan_worker;',
      );
    }
  }
}

async function scanStallLogCount() {
  const logs = await compose(
    ['logs', '--no-color', '--tail', '100', 'scan-stall'],
    composeEnv,
    { timeoutMs: 10_000 },
  );
  return logs.match(/R1_010D_FAKE_CLAMD_INSTREAM/g)?.length ?? 0;
}

async function waitForScanStallAfter(previousCount, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let currentCount = previousCount;
  while (Date.now() < deadline) {
    currentCount = await scanStallLogCount();
    if (currentCount > previousCount) return currentCount;
    await delay(100);
  }
  throw new Error(
    `The owned scanner did not reach a new controlled INSTREAM stall; expected count above ${previousCount}, observed ${currentCount}.`,
  );
}

async function requireLeasedJobByFilename(originalFilename, attemptCount) {
  const rows = parsePsqlRows(
    await runPsql(
      `SELECT d.id::text,j.id::text,j.status,j.attempt_count::text,d.safety_state ` +
        `FROM inquiry_source_document d JOIN inquiry_source_document_scan_job j ON j.source_document_id=d.id ` +
        `WHERE d.original_filename=${sqlLiteral(originalFilename)};`,
    ),
  );
  const row = rows[0];
  if (
    !row ||
    row[2] !== 'LEASED' ||
    Number(row[3]) !== attemptCount ||
    row[4] !== 'QUARANTINED'
  )
    throw new Error(
      `The controlled scanner stall did not retain the expected leased fixture: ${JSON.stringify(row)}`,
    );
  return { id: row[0], job_id: row[1] };
}

async function killOwnedComposeService(service) {
  const ids = (await compose(['ps', '-q', service]))
    .split(/\r?\n/)
    .filter(Boolean);
  if (ids.length !== 1)
    throw new Error(`Expected exactly one owned ${service} container.`);
  const containers = JSON.parse(await run('docker', ['inspect', ids[0]]));
  if (
    containers.length !== 1 ||
    containers[0].Config?.Labels?.['com.docker.compose.project'] !== project ||
    containers[0].Config?.Labels?.['com.docker.compose.service'] !== service
  )
    throw new Error(
      `Refusing to terminate a container not owned by this task's ${service} service.`,
    );
  await run('docker', ['kill', '--signal=KILL', ids[0]]);
}

async function provisionScanLogins() {
  const roles = [
    ['stdu_scan_worker_test', 'stdu_scan_worker', workerPassword],
    ['stdu_scan_operator_test', 'stdu_scan_operator', operatorPassword],
  ];
  const statements = ['BEGIN;'];
  for (const [login, grantedRole, password] of roles) {
    statements.push(
      `CREATE ROLE ${login} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${sqlLiteral(password)};`,
      `GRANT ${grantedRole} TO ${login};`,
    );
  }
  statements.push('COMMIT;');
  await runPsql(statements.join('\n'));

  const roleRows = parsePsqlRows(
    await runPsql(
      `SELECT r.rolname,r.rolsuper::text,r.rolcreatedb::text,r.rolcreaterole::text,r.rolreplication::text,r.rolbypassrls::text,` +
        `pg_has_role(r.oid,CASE WHEN r.rolname='stdu_scan_worker_test' THEN 'stdu_scan_worker' ELSE 'stdu_scan_operator' END,'MEMBER')::text ` +
        `FROM pg_roles r WHERE r.rolname IN ('stdu_scan_worker_test','stdu_scan_operator_test') ORDER BY r.rolname;`,
    ),
  );
  if (
    roleRows.length !== 2 ||
    roleRows.some(
      (role) =>
        role[1] !== 'false' ||
        role[2] !== 'false' ||
        role[3] !== 'false' ||
        role[4] !== 'false' ||
        role[5] !== 'false' ||
        role[6] !== 'true',
    )
  )
    throw new Error(
      'Disposable scanner database identities do not have the expected restricted membership.',
    );

  const membershipRows = parsePsqlRows(
    await runPsql(
      `SELECT granted.rolname,member.rolname FROM pg_auth_members m ` +
        `JOIN pg_roles granted ON granted.oid=m.roleid ` +
        `JOIN pg_roles member ON member.oid=m.member ` +
        `WHERE granted.rolname IN ('stdu_scan_migration_owner','stdu_scan_worker','stdu_scan_operator') ` +
        `OR member.rolname IN ('stdu_scan_migration_owner','stdu_scan_worker','stdu_scan_operator') ` +
        `ORDER BY granted.rolname,member.rolname;`,
    ),
  ).map((row) => row.join(':'));
  if (
    membershipRows.length !== 2 ||
    !membershipRows.includes('stdu_scan_worker:stdu_scan_worker_test') ||
    !membershipRows.includes('stdu_scan_operator:stdu_scan_operator_test')
  )
    throw new Error(
      'Disposable scanner role memberships include an unexpected principal.',
    );
}

async function verifyOwnedResources() {
  const ignoreInterrupt = shutdownController.signal.aborted;
  const ids = await compose(['ps', '-aq'], composeEnv, { ignoreInterrupt })
    .then((text) => text.split(/\r?\n/).filter(Boolean))
    .catch((error) => {
      throw new Error(
        `Could not verify ownership of Compose project ${project}; cleanup is blocked: ${error.message}`,
      );
    });
  if (ids.length) {
    const inspected = JSON.parse(
      await run('docker', ['inspect', ...ids], { ignoreInterrupt }),
    );
    if (
      inspected.some(
        (container) =>
          container.Config?.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing operation: Compose project ${project} returned a container without its ownership label.`,
      );
  }
  const volumeNames = await run(
    'docker',
    [
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${project}`,
    ],
    { ignoreInterrupt },
  ).then((text) => text.split(/\r?\n/).filter(Boolean));
  if (volumeNames.length) {
    const volumes = JSON.parse(
      await run('docker', ['volume', 'inspect', ...volumeNames], {
        ignoreInterrupt,
      }),
    );
    if (
      volumes.some(
        (volume) => volume.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing cleanup: a volume for ${project} has a foreign ownership label.`,
      );
  }
}

async function verifyNetworkBoundary({ requireScanStall = false } = {}) {
  const networkIds = (
    await run('docker', [
      'network',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${project}`,
    ])
  )
    .split(/\r?\n/)
    .filter(Boolean);
  if (networkIds.length !== 6)
    throw new Error(
      `Expected six task-owned Compose networks before inspection, found ${networkIds.length}.`,
    );
  const networks = JSON.parse(
    await run('docker', ['network', 'inspect', ...networkIds]),
  );
  const networkByLogicalName = new Map(
    networks.map((network) => [
      network.Labels?.['com.docker.compose.network'],
      network,
    ]),
  );
  if (networkByLogicalName.size !== 6)
    throw new Error(
      `Expected six task-owned Compose networks, found ${networkByLogicalName.size}.`,
    );
  const internalNetworks = [
    'database',
    'application',
    'scanner_internal',
    'scan_stream',
    'clamav_seed',
  ];
  for (const name of internalNetworks) {
    if (networkByLogicalName.get(name)?.Internal !== true)
      throw new Error(`The isolated ${name} Docker network is not internal.`);
  }
  const signatureNetwork = networkByLogicalName.get('signature_egress');
  if (!signatureNetwork || signatureNetwork.Internal)
    throw new Error('ClamAV signature-update egress is unexpectedly isolated.');
  for (const [name, network] of networkByLogicalName) {
    if (name !== 'signature_egress' && !network.Internal)
      throw new Error(`Unexpected non-internal task network: ${name}.`);
    const expectedSubnet = networkSubnets?.[name]?.subnet;
    const actualSubnets = (network.IPAM?.Config ?? []).map(
      (configuration) => configuration.Subnet,
    );
    if (
      !expectedSubnet ||
      actualSubnets.length !== 1 ||
      actualSubnets[0] !== expectedSubnet
    )
      throw new Error(
        `${name} subnet does not match this run's verified allocation.`,
      );
  }

  const containerIds = (await compose(['ps', '-aq']))
    .split(/\r?\n/)
    .filter(Boolean);
  const containers = JSON.parse(
    await run('docker', ['inspect', ...containerIds]),
  );
  const expectedNetworks = {
    postgres: ['database'],
    redis: ['application'],
    'clamav-seed': ['clamav_seed', 'signature_egress'],
    clamav: ['scanner_internal', 'signature_egress'],
    api: ['database', 'application', 'scan_stream'],
    'scan-worker': ['database', 'scanner_internal', 'scan_stream'],
    'r1-test-runner': ['database', 'application'],
  };
  if (requireScanStall) expectedNetworks['scan-stall'] = ['scanner_internal'];
  const byService = new Map(
    containers.map((container) => [
      container.Config?.Labels?.['com.docker.compose.service'],
      container,
    ]),
  );
  for (const container of containers) {
    const service = container.Config?.Labels?.['com.docker.compose.service'];
    if (!service || !Object.hasOwn(expectedNetworks, service))
      throw new Error(
        `Unexpected task-owned Compose container service: ${service}.`,
      );
  }
  for (const [service, expected] of Object.entries(expectedNetworks)) {
    const container = byService.get(service);
    if (
      !container ||
      container.Config?.Labels?.['com.docker.compose.project'] !== project
    )
      throw new Error(`Could not verify the owned ${service} container.`);
    const actual = Object.keys(container.NetworkSettings?.Networks ?? {})
      .map((name) => name.slice(project.length + 1))
      .sort();
    if (actual.join(',') !== [...expected].sort().join(','))
      throw new Error(
        `${service} is attached to unexpected Docker networks: ${actual.join(',')}`,
      );
  }
  for (const [service, port] of [
    ['postgres', '5432/tcp'],
    ['api', '3001/tcp'],
    ['r1-test-runner', '3001/tcp'],
  ]) {
    const bindings =
      byService.get(service)?.NetworkSettings?.Ports?.[port] ?? [];
    if (bindings.length !== 0)
      throw new Error(`${service} must not publish ${port} on the test host.`);
  }
  const serviceLimits = {
    postgres: [2 * 1024 ** 3, 1_000_000_000],
    redis: [256 * 1024 ** 2, 250_000_000],
    'clamav-seed': [256 * 1024 ** 2, 250_000_000],
    clamav: [6 * 1024 ** 3, 1_000_000_000],
    api: [1024 ** 3, 500_000_000],
    'scan-worker': [1024 ** 3, 500_000_000],
    'r1-test-runner': [2 * 1024 ** 3, 1_000_000_000],
  };
  if (requireScanStall)
    serviceLimits['scan-stall'] = [128 * 1024 ** 2, 250_000_000];
  for (const [service, [memoryBytes, nanoCpus]] of Object.entries(
    serviceLimits,
  )) {
    const container = byService.get(service);
    if (
      container?.HostConfig?.Memory !== memoryBytes ||
      container?.HostConfig?.NanoCpus !== nanoCpus
    )
      throw new Error(
        `${service} must have ${memoryBytes} bytes and ${nanoCpus} nanoCPUs of explicit limits; got ${container?.HostConfig?.Memory}/${container?.HostConfig?.NanoCpus}.`,
      );
  }
  const signatureContainerIds = Object.keys(signatureNetwork.Containers ?? {});
  const expectedClamavId = byService.get('clamav')?.Id;
  if (byService.get('clamav')?.HostConfig?.CgroupnsMode !== 'private')
    throw new Error(
      'Scanner must use a private cgroup namespace for local OOM telemetry.',
    );
  if (
    signatureContainerIds.length !== 1 ||
    signatureContainerIds[0] !== expectedClamavId
  )
    throw new Error(
      'Only the task-owned ClamAV container may attach to signature egress.',
    );
  console.log(
    'Verified every API, database, worker, scanner and test-runner attachment is on internal networks; only the ClamAV updater and scanner have signature egress, and API/PostgreSQL publish no host ports.',
  );
}

async function removeTaskImage(tag) {
  let images;
  try {
    images = JSON.parse(
      await run('docker', ['image', 'inspect', tag], {
        ignoreInterrupt: true,
      }),
    );
  } catch (error) {
    if (/no such image/i.test(error.message)) return;
    throw error;
  }
  if (
    images.length !== 1 ||
    !images[0]?.RepoTags?.includes(tag) ||
    !images[0]?.Id
  )
    throw new Error(
      `Refusing to remove a Docker image that is not the exact task tag ${tag}.`,
    );
  const containerIds = (
    await compose(['ps', '-aq'], composeEnv, { ignoreInterrupt: true })
  )
    .split(/\r?\n/)
    .filter(Boolean);
  if (containerIds.length) {
    const containers = JSON.parse(
      await run('docker', ['inspect', ...containerIds], {
        ignoreInterrupt: true,
      }),
    );
    if (
      containers.some(
        (container) =>
          container.Config?.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing to remove task image ${tag} while a foreign container uses it.`,
      );
    throw new Error(
      `Refusing to remove task image ${tag} while task-owned containers still reference it.`,
    );
  }
  await run('docker', ['image', 'rm', tag], { ignoreInterrupt: true });
}

async function cleanupCompose() {
  if (composeAttempted) {
    await verifyOwnedResources();
    await compose(
      ['down', '--remove-orphans', '--volumes', '--timeout', '30'],
      composeEnv,
      { timeoutMs: 90_000, ignoreInterrupt: true },
    );
  }
  for (const probeId of [...testNetworkProbeIds])
    await removeOwnedNetworkProbe(probeId);
  await removeTaskImage(image);
  await removeTaskImage(runnerImage);
  await removeTaskImage(clamavImage);
}

function testEnv(uploadProfile) {
  return {
    ...process.env,
    ...(composeEnv ?? {}),
    R1_010D_PG_PASSWORD: pgPassword,
    R1_010D_RUNTIME_PASSWORD: runtimePassword,
    R1_010D_WORKER_PASSWORD: workerPassword,
    R1_010D_OPERATOR_PASSWORD: operatorPassword,
    R1_010D_REDIS_PASSWORD: redisPassword,
    R1_010D_SESSION_HMAC_KEY: sessionKey,
    R1_010D_RATE_LIMIT_KEY: rateLimitKey,
    R1_010D_API_IMAGE: image,
    R1_010D_RUNNER_IMAGE: runnerImage,
    R1_010D_TEST_RUN_ID: testRunId,
    R1_010D_UPLOAD_PROFILE: uploadProfile,
    R1_010D_TEST_COMPOSE_PROJECT: project,
    R1_010D_TEST_COMPOSE_FILE: composeFile,
  };
}

async function runRuntimeTests(pattern, uploadProfile) {
  const output = await runInTestRunner(
    [
      'pnpm',
      'exec',
      'vitest',
      'run',
      '--silent=false',
      'apps/api/test/r1-010d.pipeline.runtime.test.ts',
      `--testNamePattern=${pattern}`,
    ],
    uploadProfile,
    14 * 60_000,
  );
  const summary = output
    .split(/\r?\n/)
    .filter((line) =>
      /^(?:\s*Test Files|\s*Tests|\s*Duration|\s*Start at|\s*✓|\s*❯|\s*FAIL|\s*PASS)/.test(
        line,
      ),
    )
    .slice(-12);
  console.log(
    `Runtime tests ${pattern} (${uploadProfile}):\n${summary.length ? summary.join('\n') : output.slice(-4000)}`,
  );
  return output;
}

async function runInTestRunner(
  args,
  uploadProfile = 'MVP_SAFE',
  timeoutMs = 180_000,
) {
  return compose(
    [
      'exec',
      '-T',
      '-e',
      `R1_010D_UPLOAD_PROFILE=${uploadProfile}`,
      'r1-test-runner',
      ...args,
    ],
    testEnv(uploadProfile),
    { timeoutMs },
  );
}

function parseCpuPercent(value) {
  const number = Number.parseFloat(value.replace('%', ''));
  return Number.isFinite(number) ? number : 0;
}

function parseMemoryMiB(value) {
  const match = /([\d.]+)\s*(B|KiB|MiB|GiB)/i.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === 'gib'
    ? amount * 1024
    : unit === 'mib'
      ? amount
      : unit === 'kib'
        ? amount / 1024
        : amount / (1024 * 1024);
}

async function monitorResources() {
  while (!monitorStop) {
    try {
      const listOwnedRunningIds = () =>
        run('docker', [
          'ps',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ]).then((text) => text.split(/\r?\n/).filter(Boolean));
      const sampleIds = (ids) =>
        run(
          'docker',
          [
            'stats',
            '--no-stream',
            '--format',
            '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
            ...ids,
          ],
          { timeoutMs: 15_000 },
        );
      const ids = await listOwnedRunningIds();
      if (ids.length) {
        let stats;
        try {
          stats = await sampleIds(ids);
        } catch (firstError) {
          const currentIds = await listOwnedRunningIds();
          if (!currentIds.length) {
            if (!resourceSnapshots.length) throw firstError;
          } else {
            stats = await sampleIds(currentIds).catch((retryError) => {
              throw new Error(
                `Docker stats failed for owned containers: ${firstError.message}; retry: ${retryError.message}`,
              );
            });
          }
        }
        for (const line of (stats ?? '').split(/\r?\n/)) {
          const [name, cpuText, memoryText] = line.split('|');
          if (!name || !cpuText || !memoryText) continue;
          const memory = memoryText.split('/')[0]?.trim() ?? '';
          const service = name.replace(`${project}-`, '').replace(/-\d+$/, '');
          resourceSnapshots.push({
            name: service,
            cpuPercent: parseCpuPercent(cpuText),
            memoryMiB: parseMemoryMiB(memory),
            rawMemory: memoryText,
          });
        }
      }
    } catch (error) {
      monitorError ??= error;
    }
    await delay(2500);
  }
}

function printResourcePeaks() {
  if (monitorError)
    throw new Error(
      `Resource sampling was incomplete: ${monitorError.message}`,
    );
  if (!resourceSnapshots.length)
    throw new Error('No Docker resource samples were collected.');
  const sampledServices = new Set(resourceSnapshots.map(({ name }) => name));
  const requiredServices = [
    'postgres',
    'redis',
    'clamav',
    'api',
    'scan-worker',
    'scan-stall',
    'r1-test-runner',
  ];
  const missingServices = requiredServices.filter(
    (service) => !sampledServices.has(service),
  );
  if (missingServices.length)
    throw new Error(
      `Docker resource samples are missing required services: ${missingServices.join(', ')}.`,
    );
  const byName = new Map();
  for (const sample of resourceSnapshots) {
    const current = byName.get(sample.name) ?? {
      cpuPercent: 0,
      memoryMiB: 0,
      rawMemory: '',
    };
    if (sample.cpuPercent > current.cpuPercent)
      current.cpuPercent = sample.cpuPercent;
    if (sample.memoryMiB > current.memoryMiB) {
      current.memoryMiB = sample.memoryMiB;
      current.rawMemory = sample.rawMemory;
    }
    byName.set(sample.name, current);
  }
  console.log(
    'Observed Docker resource peaks during the isolated stack run (sampled every 2.5s; Compose container limits enforce upper bounds):',
  );
  for (const [name, peak] of [...byName].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
    console.log(
      `- ${name}: CPU max ${peak.cpuPercent.toFixed(1)}%, memory max ${peak.memoryMiB.toFixed(0)} MiB (${peak.rawMemory})`,
    );
}

let resourceMonitor;

async function stopResourceMonitor() {
  monitorStop = true;
  if (resourceMonitor) {
    await resourceMonitor;
    resourceMonitor = undefined;
  }
}

async function main() {
  await run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    timeoutMs: 10_000,
  });
  networkSubnets = await reserveDockerNetworks();
  apiStreamIp = networkSubnets.scan_stream.address;
  composeEnv = {
    ...process.env,
    R1_010D_DATABASE_SUBNET: networkSubnets.database.subnet,
    R1_010D_APPLICATION_SUBNET: networkSubnets.application.subnet,
    R1_010D_SCANNER_SUBNET: networkSubnets.scanner_internal.subnet,
    R1_010D_SCANNER_IP: networkSubnets.scanner_internal.address,
    R1_010D_SCAN_STREAM_SUBNET: networkSubnets.scan_stream.subnet,
    R1_010D_SIGNATURE_EGRESS_SUBNET: networkSubnets.signature_egress.subnet,
    R1_010D_CLAMAV_SEED_SUBNET: networkSubnets.clamav_seed.subnet,
    R1_010D_API_STREAM_IP: apiStreamIp,
    R1_010D_PG_PASSWORD: pgPassword,
    R1_010D_RUNTIME_PASSWORD: runtimePassword,
    R1_010D_WORKER_PASSWORD: workerPassword,
    R1_010D_OPERATOR_PASSWORD: operatorPassword,
    R1_010D_REDIS_PASSWORD: redisPassword,
    R1_010D_SESSION_HMAC_KEY: sessionKey,
    R1_010D_RATE_LIMIT_KEY: rateLimitKey,
    R1_010D_API_IMAGE: image,
    R1_010D_RUNNER_IMAGE: runnerImage,
    R1_010D_CLAMAV_IMAGE: clamavImage,
    R1_010D_TEST_RUN_ID: testRunId,
    R1_010D_UPLOAD_PROFILE: 'MVP_SAFE',
  };
  const config = await compose(['config', '--quiet'], composeEnv, {
    timeoutMs: 30_000,
  });
  void config;
  composeAttempted = true;
  monitorStop = false;
  resourceMonitor = monitorResources();
  console.log(
    `Starting isolated scanner project ${project}; API, PostgreSQL, Redis, worker, and test runner use internal networks with no published host ports.`,
  );
  await compose(['build', 'r1-test-runner', 'clamav'], composeEnv, {
    timeoutMs: 900_000,
  });
  await compose(
    [
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '900',
      'postgres',
      'redis',
      'clamav',
    ],
    composeEnv,
    { timeoutMs: 960_000 },
  );
  await compose(['up', '-d', '--no-deps', 'r1-test-runner'], composeEnv, {
    timeoutMs: 60_000,
  });

  await runInTestRunner(
    ['node', 'apps/api/scripts/prepare-runtime-role.mjs'],
    'MVP_SAFE',
  );
  await runInTestRunner(
    ['node', 'apps/api/scripts/deploy-pre-scan-migrations.mjs'],
    'MVP_SAFE',
    240_000,
  );
  const legacyBackfillFixtures = await seedLegacyBackfillFixtures();
  await verifyReservedScannerRolePreflight();
  await runInTestRunner(
    [
      'pnpm',
      '--filter',
      '@stdu/api',
      'exec',
      'prisma',
      'migrate',
      'deploy',
      '--config',
      'prisma.config.ts',
    ],
    'MVP_SAFE',
    240_000,
  );
  await verifyLegacyBackfill(legacyBackfillFixtures);
  await provisionScanLogins();

  await compose(
    ['up', '-d', '--build', '--wait', '--wait-timeout', '180', 'api'],
    composeEnv,
    { timeoutMs: 360_000 },
  );
  await runRuntimeTests('R1_010D_UPLOAD', 'MVP_SAFE');

  composeEnv.R1_010D_UPLOAD_PROFILE = 'ENGINEERING_DOCUMENTS';
  await compose(
    ['up', '-d', '--force-recreate', '--wait', '--wait-timeout', '180', 'api'],
    composeEnv,
    { timeoutMs: 240_000 },
  );
  await runRuntimeTests('R1_010D_UPLOAD', 'ENGINEERING_DOCUMENTS');

  await runRuntimeTests('R1_010D_DB_', 'MVP_SAFE');
  composeEnv.R1_010D_CLAMD_HOST = '127.0.0.1';
  await compose(['up', '-d', 'scan-worker'], composeEnv, { timeoutMs: 90_000 });
  await verifyNetworkBoundary();
  await runRuntimeTests('R1_010D_SCAN_OFFLINE', 'MVP_SAFE');
  await compose(['stop', '--timeout', '20', 'scan-worker'], composeEnv, {
    timeoutMs: 45_000,
  });

  await compose(['up', '-d', 'scan-stall'], composeEnv, {
    timeoutMs: 90_000,
  });
  await verifyNetworkBoundary({ requireScanStall: true });
  await runRuntimeTests('R1_010D_SCAN_HARD_TIMEOUT_PREP', 'MVP_SAFE');
  composeEnv.R1_010D_CLAMD_HOST = 'scan-stall';
  composeEnv.R1_010D_SCAN_DEADLINE_MS = '500';
  await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
    timeoutMs: 150_000,
  });
  await runRuntimeTests('R1_010D_SCAN_HARD_TIMEOUT_VERIFY', 'MVP_SAFE');
  await compose(['stop', '--timeout', '20', 'scan-worker'], composeEnv, {
    timeoutMs: 45_000,
  });

  await runRuntimeTests('R1_010D_SCAN_RESTART_PREP', 'MVP_SAFE');
  composeEnv.R1_010D_SCAN_DEADLINE_MS = '180000';
  let stallCount = await scanStallLogCount();
  await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
    timeoutMs: 150_000,
  });
  const restartFilename = `r1-010d-${testRunId}-restart.pdf`;
  await waitForScanStallAfter(stallCount);
  const firstLease = await requireLeasedJobByFilename(restartFilename, 1);
  await killOwnedComposeService('scan-worker');
  const killedJob = parsePsqlRows(
    await runPsql(
      `SELECT j.status,j.attempt_count::text,d.safety_state ` +
        `FROM inquiry_source_document_scan_job j ` +
        `JOIN inquiry_source_document d ON d.id=j.source_document_id ` +
        `WHERE j.id=${sqlLiteral(firstLease.job_id)}::uuid;`,
    ),
  )[0];
  if (
    killedJob?.[0] !== 'LEASED' ||
    Number(killedJob?.[1]) !== 1 ||
    killedJob?.[2] !== 'QUARANTINED'
  )
    throw new Error(
      'A killed scanner process changed the source or lease unexpectedly.',
    );
  await runPsql(
    `UPDATE inquiry_source_document_scan_job ` +
      `SET lease_expires_at=clock_timestamp()-interval '1 second' ` +
      `WHERE id=${sqlLiteral(firstLease.job_id)}::uuid AND status='LEASED' AND attempt_count=1;`,
  );
  stallCount = await scanStallLogCount();
  await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
    timeoutMs: 150_000,
  });
  await waitForScanStallAfter(stallCount);
  await requireLeasedJobByFilename(restartFilename, 2);
  await compose(['stop', '--timeout', '20', 'scan-worker'], composeEnv, {
    timeoutMs: 45_000,
  });
  await runRuntimeTests('R1_010D_SCAN_RESTART_VERIFY', 'MVP_SAFE');

  for (const mode of [
    'unavailable',
    'scratch',
    'oom',
    'instance',
    'malformed',
    'stale',
    'timeout',
    'statfs',
    'config',
    'cgroupmissing',
    'cgroupmalformed',
  ]) {
    await runRuntimeTests(`R1_010D_RESOURCE_${mode}_PREP`, 'MVP_SAFE');
    composeEnv.R1_010D_FAKE_PROBE_FAIL_AFTER_SCAN = mode;
    await compose(
      ['up', '-d', '--no-deps', '--force-recreate', 'scan-stall'],
      composeEnv,
      { timeoutMs: 90_000 },
    );
    await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
      timeoutMs: 150_000,
    });
    await runRuntimeTests(`R1_010D_RESOURCE_${mode}_VERIFY`, 'MVP_SAFE');
    await compose(['stop', '--timeout', '20', 'scan-worker'], composeEnv, {
      timeoutMs: 45_000,
    });
  }

  await runRuntimeTests('R1_010D_RESOURCE_before_PREP', 'MVP_SAFE');
  composeEnv.R1_010D_FAKE_PROBE_FAIL_AFTER_SCAN = 'before';
  await compose(
    [
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '30',
      'scan-stall',
    ],
    composeEnv,
    { timeoutMs: 90_000 },
  );
  await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
    timeoutMs: 150_000,
  });
  await runRuntimeTests('R1_010D_RESOURCE_before_VERIFY', 'MVP_SAFE');
  await compose(['stop', '--timeout', '20', 'scan-worker'], composeEnv, {
    timeoutMs: 45_000,
  });

  composeEnv.R1_010D_CLAMD_HOST = 'clamav';
  composeEnv.R1_010D_SCAN_DEADLINE_MS = '180000';
  await runPsql(
    `UPDATE inquiry_source_document_scan_job j ` +
      `SET available_at=clock_timestamp(), ` +
      `lease_expires_at=CASE WHEN j.status='LEASED' ` +
      `THEN clock_timestamp()-interval '1 second' ELSE j.lease_expires_at END ` +
      `FROM inquiry_source_document d ` +
      `WHERE d.id=j.source_document_id ` +
      `AND d.original_filename LIKE ${sqlLiteral(`r1-010d-${testRunId}-%`)} ` +
      `AND j.status IN ('PENDING','RETRY_WAIT','LEASED');`,
  );
  await compose(['up', '-d', '--force-recreate', 'scan-worker'], composeEnv, {
    timeoutMs: 150_000,
  });
  await runRuntimeTests('R1_010D_SCAN_FINAL', 'MVP_SAFE');
  const generated = await runInTestRunner([
    'pnpm',
    'exec',
    'vitest',
    'run',
    '--silent=false',
    'apps/api/test/r1-010d.pipeline.runtime.test.ts',
    '--testNamePattern=R1_010D_PINNED_CLAMD_FIXTURES',
  ]);
  for (const [name, expected] of [
    ['DIRECT_EICAR', 'Eicar-Test-Signature FOUND'],
    ['ZIP_EICAR', 'Eicar-Test-Signature FOUND'],
    ['XLSX_EICAR', null],
    ['OLE_LIMIT', 'Heuristics.XZ.DicSizeLimit FOUND'],
    ['OLE_EICAR', 'Eicar-Test-Signature FOUND'],
    ['FILE_COUNT', 'Heuristics.Limits.Exceeded.MaxFiles FOUND'],
    ['FILE_SIZE_CONTROL', null],
    ['FILE_SIZE', null],
    ['SCAN_SIZE', null],
  ]) {
    const match = new RegExp(
      `R1_010D_GENERATED_${name}=([A-Za-z0-9+/=]+)`,
    ).exec(generated);
    if (!match) throw new Error(`Missing generated ${name} scanner fixture.`);
    const output = await compose(
      [
        'exec',
        '-T',
        'clamav',
        '/bin/sh',
        '-c',
        'clamdscan --no-summary --stream -; code=$?; [ "$code" -eq 0 ] || [ "$code" -eq 1 ]',
      ],
      composeEnv,
      { input: Buffer.from(match[1], 'base64'), timeoutMs: 60_000 },
    );
    if (expected && !output.includes(expected))
      throw new Error(
        `Pinned clamd ${name} fixture did not produce its expected exact alert.`,
      );
    console.log(`Pinned clamd generated ${name} fixture: ${output.trim()}`);
  }
  await compose(
    ['exec', '-T', 'scan-worker', 'node', 'dist/scan-worker/healthcheck.js'],
    composeEnv,
    { timeoutMs: 25_000 },
  );
  // Exercise a real SIGTERM only against this run's scanner container, after
  // all test jobs have reached terminal states. Never select by process name.
  const scannerId = await compose(['ps', '-q', 'clamav'], composeEnv);
  if (!/^[a-f0-9]{12,64}$/.test(scannerId))
    throw new Error('Could not identify the owned scanner container.');
  const scannerInspect = JSON.parse(
    await run('docker', ['inspect', scannerId], { timeoutMs: 10_000 }),
  );
  if (
    scannerInspect[0]?.Config?.Labels?.['com.docker.compose.project'] !==
    project
  )
    throw new Error(
      'Scanner SIGTERM target is not owned by this test project.',
    );
  const processesBefore = await run('docker', ['top', scannerId], {
    timeoutMs: 10_000,
  });
  if (
    !processesBefore.includes('resource-probe') ||
    !processesBefore.includes('clamd')
  )
    throw new Error(
      'Scanner and resource probe must both be running before SIGTERM.',
    );
  await run('docker', ['kill', '--signal=SIGTERM', scannerId], {
    timeoutMs: 10_000,
  });
  const exitCode = Number(
    await run('docker', ['wait', scannerId], { timeoutMs: 30_000 }),
  );
  const stopped = JSON.parse(
    await run('docker', ['inspect', scannerId], { timeoutMs: 10_000 }),
  );
  if (stopped[0]?.State?.Running || ![0, 143].includes(exitCode))
    throw new Error(
      `Scanner container did not exit as expected after SIGTERM (exit ${exitCode}).`,
    );
  console.log(
    `Owned scanner container exited after SIGTERM (exit ${exitCode}); child-level graceful shutdown is not established.`,
  );
  await stopResourceMonitor();
  printResourcePeaks();
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error ? error.stack : 'R1-010D runtime acceptance failed.',
  );
  if (composeAttempted) {
    const serviceState = await compose(['ps', '-a'], composeEnv, {
      timeoutMs: 15_000,
    }).catch(() => '');
    if (serviceState)
      console.error('Owned disposable service state:\n' + serviceState);
    const logs = await compose(
      [
        'logs',
        '--no-color',
        '--tail',
        '80',
        'postgres',
        'redis',
        'clamav',
        'api',
        'scan-worker',
        'scan-stall',
      ],
      composeEnv,
      { timeoutMs: 30_000 },
    ).catch(() => '');
    if (logs)
      console.error(
        'Owned disposable service diagnostics (last 12 KiB):\n' +
          logs.slice(-12000),
      );
  }
  exitCode = 1;
} finally {
  try {
    await stopResourceMonitor();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Docker resource monitor failed to stop cleanly.',
    );
    exitCode = 1;
  }
  try {
    await cleanupCompose();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Owned scanner Compose cleanup failed.',
    );
    exitCode = 1;
  }
  process.exitCode = exitCode;
}
