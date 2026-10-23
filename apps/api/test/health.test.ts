import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller.js';
import { readConfig } from '../src/config.js';

describe('API health boundary', () => {
  const validConfig = {
    APP_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: '3001',
    COOKIE_PROFILE: 'loopback',
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:5432/local',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    SESSION_HMAC_KEY: 'a'.repeat(64),
    RATE_LIMIT_KEY: 'b'.repeat(64),
    STAFF_ORIGINS: 'http://127.0.0.1:3000',
  };

  it('keeps liveness independent of unavailable dependencies', () => {
    const check = vi.fn();
    expect(new HealthController({ check }).live()).toEqual({ status: 'ok' });
    expect(check).not.toHaveBeenCalled();
  });
  it('requires both dependencies to be ready', async () => {
    const controller = new HealthController({
      check: async () => ({ postgres: 'up', redis: 'up' }),
    });
    expect(await controller.ready()).toEqual({
      status: 'ready',
      checks: { postgres: 'up', redis: 'up' },
    });
  });
  it.each(['postgres', 'redis'] as const)(
    'returns a sanitized 503 when %s is down',
    async (dependency) => {
      const checks = {
        postgres: 'up',
        redis: 'up',
        [dependency]: 'down',
      } as const;
      const controller = new HealthController({ check: async () => checks });
      try {
        await controller.ready();
        expect.fail('Readiness accepted a failed dependency');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getStatus()).toBe(503);
        expect((error as ServiceUnavailableException).getResponse()).toEqual({
          status: 'not_ready',
          checks,
        });
      }
    },
  );
  it('rejects configuration without exposing its secret value', () => {
    const invalid = {
      ...validConfig,
      DATABASE_URL: 'https://private-secret.invalid',
    };
    expect(() => readConfig(invalid)).toThrow('Invalid DATABASE_URL');
    expect(() =>
      readConfig({ ...validConfig, DATABASE_URL: undefined }),
    ).toThrow('Missing DATABASE_URL');
  });

  it('requires exact safe origins and independent strong HMAC keys', () => {
    expect(() =>
      readConfig({ ...validConfig, STAFF_ORIGINS: 'http://localhost:3000' }),
    ).toThrow(
      'COOKIE_PROFILE=loopback requires development and the exact 127.0.0.1 web origin',
    );
    expect(() =>
      readConfig({ ...validConfig, SESSION_HMAC_KEY: 'short' }),
    ).toThrow('Invalid SESSION_HMAC_KEY');
    expect(() => readConfig({ ...validConfig, APP_ENV: 'production' })).toThrow(
      'COOKIE_PROFILE=loopback requires development',
    );
    expect(() =>
      readConfig({
        ...validConfig,
        STAFF_ORIGINS: 'http://127.0.0.1:3000,http://localhost:3000',
      }),
    ).toThrow(
      'COOKIE_PROFILE=loopback requires development and the exact 127.0.0.1 web origin',
    );
    expect(() => readConfig({ ...validConfig, HOST: '0.0.0.0' })).toThrow(
      'COOKIE_PROFILE=loopback requires a loopback API bind',
    );
  });

  it('requires a single HTTPS production origin and an explicit trusted proxy', () => {
    const production = {
      ...validConfig,
      APP_ENV: 'production',
      HOST: '0.0.0.0',
      COOKIE_PROFILE: 'https',
      STAFF_ORIGINS: 'https://shop.example.invalid',
      PUBLIC_WEB_ORIGIN: 'https://shop.example.invalid',
      TRUSTED_PROXY_ADDRESS: '10.0.0.2',
    };
    expect(readConfig(production).trustedProxyAddress).toBe('10.0.0.2');
    expect(() =>
      readConfig({
        ...production,
        STAFF_ORIGINS:
          'https://shop.example.invalid,https://other.example.invalid',
      }),
    ).toThrow(
      'HTTPS production requires one PUBLIC_WEB_ORIGIN and an explicit trusted proxy address',
    );
    expect(() =>
      readConfig({ ...production, TRUSTED_PROXY_ADDRESS: undefined }),
    ).toThrow(
      'HTTPS production requires one PUBLIC_WEB_ORIGIN and an explicit trusted proxy address',
    );
    expect(() =>
      readConfig({ ...production, TRUSTED_PROXY_ADDRESS: 'proxy.internal' }),
    ).toThrow('Invalid TRUSTED_PROXY_ADDRESS');
  });
});
