import { isIP } from 'node:net';

export interface ApiConfig {
  appEnv: 'development' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  sessionHmacKey: Buffer;
  rateLimitKey: Buffer;
  cookieProfile: 'loopback' | 'https';
  allowedOrigins: string[];
  trustedProxyAddress: string | null;
  inquiryPublicEnabled: boolean;
  inquiryUploadProfile: 'MVP_SAFE' | 'ENGINEERING_DOCUMENTS';
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
  const appEnv = env.APP_ENV;
  if (appEnv !== 'development' && appEnv !== 'production')
    throw new Error('APP_ENV must be development or production');
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT');
  const cookieProfile =
    env.COOKIE_PROFILE ?? (appEnv === 'development' ? 'loopback' : undefined);
  if (cookieProfile !== 'loopback' && cookieProfile !== 'https')
    throw new Error('Invalid COOKIE_PROFILE');
  const allowedOrigins = (env.STAFF_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length === 0) throw new Error('Missing STAFF_ORIGINS');
  const host = env.HOST ?? '127.0.0.1';
  const trustedProxyAddress = env.TRUSTED_PROXY_ADDRESS?.trim() || null;
  if (trustedProxyAddress && isIP(trustedProxyAddress) === 0)
    throw new Error('Invalid TRUSTED_PROXY_ADDRESS');
  for (const origin of allowedOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Invalid STAFF_ORIGINS');
    }
    if (parsed.origin !== origin || parsed.username || parsed.password)
      throw new Error('Invalid STAFF_ORIGINS');
    if (cookieProfile === 'https' && parsed.protocol !== 'https:')
      throw new Error('COOKIE_PROFILE=https requires HTTPS STAFF_ORIGINS');
    if (
      cookieProfile === 'loopback' &&
      (appEnv !== 'development' || parsed.origin !== 'http://127.0.0.1:3000')
    )
      throw new Error(
        'COOKIE_PROFILE=loopback requires development and the exact 127.0.0.1 web origin',
      );
    if (cookieProfile === 'https' && appEnv !== 'production')
      throw new Error('COOKIE_PROFILE=https requires APP_ENV=production');
  }
  if (cookieProfile === 'loopback') {
    const containerBoundToLoopback = env.STAFF_CONTAINER_BIND === 'loopback';
    if (
      port !== 3001 ||
      (host !== '127.0.0.1' &&
        !(host === '0.0.0.0' && containerBoundToLoopback))
    )
      throw new Error('COOKIE_PROFILE=loopback requires a loopback API bind');
    if (trustedProxyAddress)
      throw new Error(
        'TRUSTED_PROXY_ADDRESS is only valid for the HTTPS production profile',
      );
  } else {
    const publicOrigin = env.PUBLIC_WEB_ORIGIN;
    if (
      !publicOrigin ||
      allowedOrigins.length !== 1 ||
      allowedOrigins[0] !== publicOrigin ||
      !trustedProxyAddress
    )
      throw new Error(
        'HTTPS production requires one PUBLIC_WEB_ORIGIN and an explicit trusted proxy address',
      );
    let parsedPublicOrigin: URL;
    try {
      parsedPublicOrigin = new URL(publicOrigin);
    } catch {
      throw new Error('Invalid PUBLIC_WEB_ORIGIN');
    }
    if (
      parsedPublicOrigin.origin !== publicOrigin ||
      parsedPublicOrigin.protocol !== 'https:' ||
      parsedPublicOrigin.username ||
      parsedPublicOrigin.password
    )
      throw new Error('Invalid PUBLIC_WEB_ORIGIN');
  }
  const key = (name: string): Buffer => {
    const value = env[name];
    if (!value || !/^[a-f0-9]{64}$/.test(value))
      throw new Error(`Invalid ${name}`);
    return Buffer.from(value, 'hex');
  };
  const inquiryPublicEnabled = env.INQUIRY_PUBLIC_ENABLED === 'true';
  if (inquiryPublicEnabled && appEnv !== 'development')
    throw new Error(
      'INQUIRY_PUBLIC_ENABLED is development-only pending legal approval',
    );
  const inquiryUploadProfile = env.INQUIRY_UPLOAD_PROFILE ?? 'MVP_SAFE';
  if (
    inquiryUploadProfile !== 'MVP_SAFE' &&
    inquiryUploadProfile !== 'ENGINEERING_DOCUMENTS'
  )
    throw new Error('Invalid INQUIRY_UPLOAD_PROFILE');
  const databaseEnv = {
    ...env,
    DATABASE_URL: env.STAFF_DATABASE_URL ?? env.DATABASE_URL,
  };
  return {
    appEnv,
    host,
    port,
    databaseUrl: requiredUrl(databaseEnv, 'DATABASE_URL', [
      'postgres:',
      'postgresql:',
    ]),
    redisUrl: requiredUrl(env, 'REDIS_URL', ['redis:', 'rediss:']),
    sessionHmacKey: key('SESSION_HMAC_KEY'),
    rateLimitKey: key('RATE_LIMIT_KEY'),
    cookieProfile,
    allowedOrigins,
    trustedProxyAddress,
    inquiryPublicEnabled,
    inquiryUploadProfile,
  };
}
