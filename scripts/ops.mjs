import { pathToFileURL } from 'node:url';
import {
  compose,
  loadLocalEnv,
  requireFreePort,
  requireLocalDocker,
  runningServices,
  reportFailure,
} from './lib.mjs';
import { withHostApps } from './host-apps.mjs';

export async function infraUp() {
  const running = await runningServices();
  if (
    running.some((service) => ['web', 'api', 'ingestion'].includes(service))
  ) {
    throw new Error(
      'Full Compose apps are running. Run pnpm compose:stop before host development.',
    );
  }
  await compose(
    ['up', '-d', '--wait', '--wait-timeout', '90', 'postgres', 'redis'],
    {},
    true,
  );
}

export async function composeUp() {
  const running = await runningServices();
  if (!running.includes('web'))
    await requireFreePort(Number(process.env.STDU_SMOKE_WEB_PORT ?? 3000));
  if (!running.includes('api'))
    await requireFreePort(Number(process.env.STDU_SMOKE_API_PORT ?? 3001));
  await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180']);
}

async function main() {
  loadLocalEnv();
  await requireLocalDocker();
  switch (process.argv[2]) {
    case 'infra-up':
      await infraUp();
      break;
    case 'infra-stop':
      await compose(['stop', 'postgres', 'redis']);
      break;
    case 'compose-up':
      await composeUp();
      break;
    case 'compose-stop':
      await compose(['stop']);
      break;
    case 'status':
      await compose(['ps']);
      break;
    case 'dev': {
      for (const port of [3000, 3001, 8000]) await requireFreePort(port);
      await infraUp();
      console.log(
        'Starting host apps. Ctrl+C stops apps; pnpm infra:stop stops the dependencies.',
      );
      await withHostApps(() => new Promise(() => {}));
      break;
    }
    default:
      throw new Error('Unknown operations command.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(reportFailure);
