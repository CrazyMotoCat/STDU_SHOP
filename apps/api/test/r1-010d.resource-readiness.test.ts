import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  parseResourceSnapshot,
  readResourceSnapshot,
  resourceSnapshotsMatch,
} from '../src/scan-worker/resource-readiness.js';

const now = 1_800_000_000_000;
const healthy = {
  ready: true,
  instance: '01234567-89ab-4cde-8fab-0123456789ab:42:100',
  measuredAt: now,
  scratchAvailableBytes: 384 * 1024 * 1024,
  oom: 0,
  oomKill: 0,
};

describe('scanner resource attestation', () => {
  it('accepts a fresh complete healthy snapshot', () => {
    expect(parseResourceSnapshot(healthy, now).instance).toBe(healthy.instance);
  });
  it.each([
    { scratchAvailableBytes: 384 * 1024 * 1024 - 1 },
    { oom: 1 },
    { oomKill: 1 },
    { measuredAt: now - 5001 },
    { measuredAt: now + 1 },
    { ready: false },
    { instance: 'invalid' },
    { unexpected: 'value' },
  ])('fails closed on invalid resource state %#', (change) => {
    expect(() =>
      parseResourceSnapshot({ ...healthy, ...change }, now),
    ).toThrow();
  });
  it('rejects scanner restart between scan boundaries', () => {
    const start = parseResourceSnapshot(healthy, now);
    const end = parseResourceSnapshot(
      { ...healthy, instance: '11234567-89ab-4cde-8fab-0123456789ab:43:101' },
      now,
    );
    expect(resourceSnapshotsMatch(start, end)).toBe(false);
  });
});

describe('resource probe transport', () => {
  it('fails closed for malformed JSON, timeouts, and an unavailable endpoint', async () => {
    const previousHost = process.env.CLAMD_HOST;
    const previousPort = process.env.SCAN_RESOURCE_PORT;
    const server = createServer((request, response) => {
      if (request.url === '/ready') response.end('{invalid');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('test bind failed');
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.SCAN_RESOURCE_PORT = String(address.port);
    try {
      await expect(
        readResourceSnapshot(Date.now() + 1000),
      ).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await expect(
        readResourceSnapshot(Date.now() + 1000),
      ).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
      const stalled = createServer(() => {});
      await new Promise<void>((resolve) =>
        stalled.listen(0, '127.0.0.1', resolve),
      );
      const stallAddress = stalled.address();
      if (!stallAddress || typeof stallAddress === 'string')
        throw new Error('test bind failed');
      process.env.SCAN_RESOURCE_PORT = String(stallAddress.port);
      try {
        await expect(
          readResourceSnapshot(Date.now() + 50),
        ).rejects.toMatchObject({ code: 'SCANNER_UNAVAILABLE' });
      } finally {
        stalled.closeAllConnections();
        await new Promise<void>((resolve) => stalled.close(() => resolve()));
      }
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousHost === undefined) delete process.env.CLAMD_HOST;
      else process.env.CLAMD_HOST = previousHost;
      if (previousPort === undefined) delete process.env.SCAN_RESOURCE_PORT;
      else process.env.SCAN_RESOURCE_PORT = previousPort;
    }
  });
});
