import { once } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  CloudmersiveAdvancedMockAdapter,
  FLAGS,
  normalizeAdvanced,
  validateStructure,
} from '../src/scan-worker/cloudmersive.js';

const clean = {
  ...Object.fromEntries(FLAGS.map((flag) => [flag, false])),
  CleanResult: true,
  FoundViruses: null,
  VerifiedFileFormat: 'csv',
};
const csv = Buffer.from('name,quantity\nrelay,2\n');

describe('SEC-API-02 mock scan policy', () => {
  it.each(['pdf', 'csv', 'xlsx'] as const)(
    'validates coherent %s response',
    (format) => {
      expect(
        normalizeAdvanced({ ...clean, VerifiedFileFormat: format }, format),
      ).toBe('CLEAN_VERIFIED');
    },
  );

  it.each([
    { CleanResult: false },
    { FoundViruses: [{ FileName: 'test.csv', VirusName: 'EICAR' }] },
    { FoundViruses: {} },
    { FoundViruses: undefined },
    { ContainsInvalidFile: true },
    { ContainsMacros: undefined },
    { VerifiedFileFormat: 'xlsx' },
    { Successful: false },
  ])('rejects incoherent or incomplete provider result %#', (overrides) => {
    expect(normalizeAdvanced({ ...clean, ...overrides }, 'csv')).toBe(
      'SCAN_INDETERMINATE',
    );
  });

  it('rejects damaged, mismatched and invalid UTF-8 fixtures before provider use', async () => {
    await expect(validateStructure(csv, 'csv')).resolves.toBe(true);
    await expect(validateStructure(csv, 'xlsx')).resolves.toBe(false);
    await expect(
      validateStructure(Buffer.from('%PDF-1.7\n%%EOF'), 'pdf'),
    ).resolves.toBe(false);
    await expect(
      validateStructure(Buffer.from('%PDF-1.7\n/Encrypt\n%%EOF'), 'pdf'),
    ).resolves.toBe(false);
    await expect(
      validateStructure(Buffer.concat([csv, Buffer.from([0xff])]), 'csv'),
    ).resolves.toBe(false);
  });

  it.each([401, 403, 429, 500, 302, 200, 0])(
    'handles mock HTTP case %i without retry or redirect',
    async (status) => {
      let calls = 0;
      const server = createServer((request, response) => {
        calls++;
        request.resume();
        if (!status) return;
        response.writeHead(status, {
          'Content-Type': 'application/json',
          Location: '/unexpected',
        });
        response.end('{incomplete');
      });
      const listening = once(server, 'listening');
      server.listen(0, '127.0.0.1');
      try {
        await listening;
        const address = server.address();
        if (!address || typeof address === 'string')
          throw new Error('Mock unavailable');
        const adapter = new CloudmersiveAdvancedMockAdapter(
          address.port,
          status ? 2_000 : 250,
        );
        expect(await adapter.scan(csv, 'csv')).toBe(
          status === 200
            ? 'SCAN_INDETERMINATE'
            : [401, 403, 429].includes(status)
              ? 'PROVIDER_BLOCKED'
              : 'SCAN_ERROR',
        );
        expect(calls).toBe(1);
      } finally {
        server.close();
        server.closeAllConnections();
      }
    },
  );
});
