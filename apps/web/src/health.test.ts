import { describe, expect, it, vi } from 'vitest';
import { readinessHandler } from './health';

describe('web readiness', () => {
  it('checks API readiness without caching', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const response = await readinessHandler(() => 'http://api:3001', request)();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ready' });
    expect(request.mock.calls[0]?.[0].toString()).toBe(
      'http://api:3001/health/ready',
    );
    expect(request.mock.calls[0]?.[1]?.cache).toBe('no-store');
  });
  it('propagates an unavailable API as 503', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 503 }));
    expect(
      (await readinessHandler(() => 'http://api:3001', request)()).status,
    ).toBe(503);
  });
  it('sanitizes connection errors and missing configuration', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('private secret'));
    const response = await readinessHandler(() => 'http://api:3001', request)();
    expect(await response.text()).not.toContain('secret');
    expect(response.status).toBe(503);
    expect((await readinessHandler(() => undefined, request)()).status).toBe(
      503,
    );
  });
});
