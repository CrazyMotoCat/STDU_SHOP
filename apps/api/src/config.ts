export interface ApiConfig {
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
}

function requiredUrl(
  env: NodeJS.ProcessEnv,
  key: string,
  protocols: string[],
): string {
  const value = env[key];
  if (!value) throw new Error(`Missing ${key}`);
  try {
    if (!protocols.includes(new URL(value).protocol)) throw new Error();
  } catch {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT');
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    databaseUrl: requiredUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:']),
    redisUrl: requiredUrl(env, 'REDIS_URL', ['redis:', 'rediss:']),
  };
}
