import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const project = 'stdu-shop-r1-001';
export const toolchain = JSON.parse(
  readFileSync(resolve(root, 'toolchain.json'), 'utf8'),
);

export function loadLocalEnv() {
  const path = resolve(root, '.env.local');
  if (!existsSync(path))
    throw new Error('Run pnpm env:init before starting services.');
  const env = parseEnv(readFileSync(path, 'utf8'));
  for (const key of [
    'APP_ENV',
    'POSTGRES_USER',
    'POSTGRES_DB',
    'POSTGRES_PASSWORD',
    'REDIS_PASSWORD',
    'DATABASE_URL',
    'REDIS_URL',
    'API_INTERNAL_URL',
  ]) {
    if (!env[key]) throw new Error(`Missing local configuration key: ${key}`);
  }
  Object.assign(process.env, env);
  return env;
}

export function uvCommand() {
  if (
    spawnSync('uv', ['--version'], { encoding: 'utf8', windowsHide: true })
      .status === 0
  ) {
    return { command: 'uv', prefix: [] };
  }
  return { command: 'python', prefix: ['-m', 'uv'] };
}

export function run(
  command,
  args,
  { capture = false, cwd = root, ...options } = {},
) {
  let executable = command;
  let actualArgs = args;
  if (command === 'pnpm') {
    if (!process.env.npm_execpath)
      throw new Error('Invoke this script through pnpm.');
    executable = process.execPath;
    actualArgs = [process.env.npm_execpath, ...args];
  } else if (command === 'uv') {
    const uv = uvCommand();
    executable = uv.command;
    actualArgs = [...uv.prefix, ...args];
  }
  return new Promise((accept, reject) => {
    const child = spawn(executable, actualArgs, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...options,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else accept(stdout.trim());
    };
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    child.once('error', finish);
    child.once('close', (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `${command} failed (exit ${code}).${capture ? ' Check the service or tool logs.' : ''}`,
          ),
        );
      // Captured errors can include connection strings; never print stderr automatically.
      void stderr;
    });
  });
}

export function composeArgs(host = false) {
  return [
    'compose',
    '--project-directory',
    root,
    '--env-file',
    resolve(root, '.env.local'),
    '-p',
    project,
    '-f',
    resolve(root, 'infra/compose/compose.yaml'),
    ...(host ? ['-f', resolve(root, 'infra/compose/compose.host.yaml')] : []),
  ];
}

export function compose(args, options = {}, host = false) {
  return run('docker', [...composeArgs(host), ...args], options);
}

export async function requireLocalDocker() {
  const info = JSON.parse(
    await run('docker', ['context', 'inspect'], { capture: true }),
  );
  const endpoint = info[0]?.Endpoints?.docker?.Host ?? '';
  if (!endpoint.startsWith('npipe://') && !endpoint.startsWith('unix://')) {
    throw new Error(
      'This command requires a local Docker context (named pipe or Unix socket).',
    );
  }
  if (process.env.APP_ENV !== 'development')
    throw new Error('This command requires APP_ENV=development.');
}

export async function requireFreePort(port) {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} is occupied. Stop the other mode/process first.`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(accept));
  });
}

export async function runningServices() {
  const output = await compose(['ps', '--status', 'running', '--services'], {
    capture: true,
  });
  return output.split(/\r?\n/).filter(Boolean);
}

export function reportFailure(error) {
  console.error(error instanceof Error ? error.message : 'Command failed.');
  process.exitCode = 1;
}
