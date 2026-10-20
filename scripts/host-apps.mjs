import concurrently from 'concurrently';
import { uvCommand } from './lib.mjs';

export function startHostApps() {
  const uv = uvCommand();
  return concurrently(
    [
      { name: 'web', command: 'pnpm --filter @stdu/web dev' },
      { name: 'api', command: 'pnpm --filter @stdu/api dev' },
      {
        name: 'ingestion',
        command: `${uv.command} ${uv.prefix.join(' ')} run --project services/ingestion --locked uvicorn ingestion.main:app --host 127.0.0.1 --port 8000 --reload --reload-dir services/ingestion/src`,
      },
    ],
    {
      prefix: 'name',
      killOthersOn: ['failure'],
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '3001',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  );
}
