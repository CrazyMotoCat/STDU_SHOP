import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { root } from './lib.mjs';
import { withProcesses } from './process-lifecycle.mjs';

export function hostDefinitions({ smoke = false } = {}) {
  const web = resolve(root, 'apps/web');
  const api = resolve(root, 'apps/api');
  const requireWeb = createRequire(resolve(web, 'package.json'));
  const requireRoot = createRequire(resolve(root, 'package.json'));
  const python = resolve(
    root,
    'services/ingestion/.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  return [
    {
      name: 'web',
      command: process.execPath,
      args: [
        requireWeb.resolve('next/dist/bin/next'),
        smoke ? 'start' : 'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        smoke ? (process.env.STDU_SMOKE_WEB_PORT ?? '3000') : '3000',
      ],
      cwd: web,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
    {
      name: 'api',
      command: process.execPath,
      args: smoke
        ? ['dist/main.js']
        : [requireRoot.resolve('tsx/cli'), 'watch', 'src/main.ts'],
      cwd: api,
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '3001',
      },
    },
    {
      name: 'ingestion',
      command: python,
      args: [
        '-m',
        'uvicorn',
        'ingestion.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        smoke ? (process.env.STDU_SMOKE_INGESTION_PORT ?? '8000') : '8000',
        ...(smoke
          ? []
          : ['--reload', '--reload-dir', 'services/ingestion/src']),
      ],
    },
  ];
}

export function withHostApps(operation, options = {}) {
  return withProcesses(hostDefinitions(options), operation, options);
}
