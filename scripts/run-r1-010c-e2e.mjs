import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = resolve(repoRoot, 'infra/compose/compose.r1-010c-e2e.yaml');
const project = `stdu-r1-010c-e2e-${process.pid}-${randomUUID().slice(0, 8)}`;
const composeBase = ['compose', '--project-name', project, '-f', composeFile];
const secrets = [
  randomBytes(32).toString('base64url'),
  randomBytes(32).toString('base64url'),
];
const childEnv = {
  ...process.env,
  R1_010C_TEST_PG_PASSWORD: secrets[0],
  R1_010C_TEST_REDIS_PASSWORD: secrets[1],
};
let activeChild;
let exitCode = 0;
let composeAttempted = false;
let interrupted = false;

function redact(text) {
  let safe = text;
  for (const secret of secrets) safe = safe.replaceAll(secret, '[redacted]');
  return safe;
}

function run(command, args, { inherit = false } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: childEnv,
      windowsHide: true,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    activeChild = child;
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()));
    child.once('error', rejectRun);
    child.once('close', (code, signal) => {
      activeChild = undefined;
      if (code === 0) resolveRun({ stdout, stderr });
      else
        rejectRun(
          new Error(
            `${command} exited ${code ?? signal}: ${redact(`${stdout}\n${stderr}`).slice(-8000)}`,
          ),
        );
    });
  });
}

async function compose(args, options) {
  return run('docker', [...composeBase, ...args], options);
}

async function assertIsolationConfiguration() {
  const { stdout } = await compose(['config', '--format', 'json']);
  const configuration = JSON.parse(stdout);
  for (const [name, service] of Object.entries(configuration.services ?? {})) {
    if (service.network_mode === 'host' || service.ports?.length)
      throw new Error(
        `Refusing E2E topology: ${name} must not use host networking or publish ports.`,
      );
  }
  if (!configuration.services?.['e2e-runner'])
    throw new Error('E2E Compose runner service is missing.');
  console.log(
    'PASS isolated Compose configuration: no host networking and no published ports.',
  );
}

async function cleanupOwnedProject() {
  if (!composeAttempted) return;
  const { stdout } = await compose(['ps', '-aq']).catch(() => ({ stdout: '' }));
  const ids = stdout.split(/\r?\n/).filter(Boolean);
  if (ids.length) {
    const inspected = await run('docker', ['inspect', ...ids]);
    const containers = JSON.parse(inspected.stdout);
    if (
      containers.some(
        (container) =>
          container.Config?.Labels?.['com.docker.compose.project'] !== project,
      )
    )
      throw new Error(
        `Refusing cleanup: Compose project ${project} returned a container without its ownership label.`,
      );
  }
  await compose(['down', '--remove-orphans', '--timeout', '15'], {
    inherit: true,
  });
}

function handleSignal(signal) {
  if (interrupted) return;
  interrupted = true;
  exitCode = signal === 'SIGINT' ? 130 : 143;
  activeChild?.kill(signal);
}

process.once('SIGINT', () => handleSignal('SIGINT'));
process.once('SIGTERM', () => handleSignal('SIGTERM'));

try {
  console.log(
    `Starting isolated disposable E2E project ${project}; host ports and existing Compose projects remain untouched.`,
  );
  await assertIsolationConfiguration();
  composeAttempted = true;
  await compose(
    [
      'up',
      '--build',
      '--abort-on-container-exit',
      '--exit-code-from',
      'e2e-runner',
    ],
    { inherit: true },
  );
} catch (error) {
  exitCode = 1;
  console.error(
    redact(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    ),
  );
} finally {
  try {
    await cleanupOwnedProject();
    console.log(`PASS cleaned only owned Compose project ${project}.`);
  } catch (error) {
    exitCode = 1;
    console.error(
      redact(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ),
    );
  }
}

process.exitCode = exitCode;
