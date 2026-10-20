import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller.js';
import { readConfig } from '../src/config.js';

describe('API health boundary', () => {
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
      DATABASE_URL: 'https://private-secret.invalid',
      REDIS_URL: 'redis://localhost',
    };
    expect(() => readConfig(invalid)).toThrow('Invalid DATABASE_URL');
    expect(() => readConfig({})).toThrow('Missing DATABASE_URL');
  });
});
