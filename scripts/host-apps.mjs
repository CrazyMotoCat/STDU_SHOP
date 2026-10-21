import concurrently from 'concurrently';
import { uvCommand } from './lib.mjs';

export function startHostApps() {
  const uv = uvCommand();
  return concurrently(
    [
      {
        name: 'web',
        command: 'pnpm --filter @stdu/web dev',
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      },
      {
        name: 'api',
        command: 'pnpm --filter @stdu/api dev',
        env: { ...process.env, HOST: '127.0.0.1', PORT: '3001' },
      },
      {
        name: 'ingestion',
        command: `${uv.command} ${uv.prefix.join(' ')} run --project services/ingestion --locked uvicorn ingestion.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir services/ingestion/src`,
      },
    ],
    {
      prefix: 'name',
      killOthersOn: ['failure'],
    },
  );
}
