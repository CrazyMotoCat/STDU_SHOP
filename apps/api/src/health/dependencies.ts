import { Client } from 'pg';
import { Redis } from 'ioredis';
import type { ApiConfig } from '../config.js';

export type CheckState = 'up' | 'down';
export interface Checks {
  postgres: CheckState;
  redis: CheckState;
}
export interface ReadinessProbe {
  check(): Promise<Checks>;
}
export const READINESS_PROBE = Symbol('READINESS_PROBE');

async function postgresProbe(url: string): Promise<CheckState> {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 1500,
    query_timeout: 1500,
    statement_timeout: 1500,
  });
  client.on('error', () => {
    /* Errors are represented by sanitized readiness state. */
  });
  try {
    await client.connect();
    const result = await client.query<{ ready: number }>('SELECT 1 AS ready');
    return result.rows[0]?.ready === 1 ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function redisProbe(url: string): Promise<CheckState> {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1500,
    commandTimeout: 1500,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    /* Never log URLs or driver exceptions. */
  });
  try {
    await client.connect();
    return (await client.ping()) === 'PONG' ? 'up' : 'down';
  } catch {
    return 'down';
  } finally {
    client.disconnect();
  }
}

export class DependencyProbe implements ReadinessProbe {
  constructor(private readonly config: ApiConfig) {}
  async check(): Promise<Checks> {
    const [postgres, redis] = await Promise.all([
      postgresProbe(this.config.databaseUrl),
      redisProbe(this.config.redisUrl),
    ]);
    return { postgres, redis };
  }
}
