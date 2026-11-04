import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer, request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { expect, it, vi } from 'vitest';
import {
  createDirectTlsAgent,
  runSyntheticCampaign,
  scanLiveSynthetic,
} from '../src/scan-worker/cloudmersive-live.js';
import { requestAdvanced } from '../src/scan-worker/cloudmersive.js';

it('rejects live entry without opt-in before transport', async () => {
  vi.stubEnv('SEC_API_03_LIVE_APPROVAL', '');
  try {
    await expect(scanLiveSynthetic('comma-csv')).rejects.toThrow(
      'SEC_API_03_DISABLED',
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it('only submits known synthetic bytes, serializes reservations and cannot replay across invocations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sec-api-03-'));
  let finish!: () => void;
  let started!: () => void;
  const barrier = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const send = vi.fn(async (bytes: Buffer) => {
    expect(bytes.toString()).toBe('fixture,quantity\nsynthetic-relay,2\n');
    started();
    await barrier;
    return 'CLEAN_VERIFIED' as const;
  });
  try {
    await expect(
      runSyntheticCampaign(directory, '../real.pdf', send),
    ).rejects.toThrow('UNKNOWN_FIXTURE');
    const active = runSyntheticCampaign(directory, 'comma-csv', send);
    await entered;
    try {
      await expect(
        runSyntheticCampaign(directory, 'semicolon-csv', send),
      ).rejects.toThrow();
    } finally {
      finish();
    }
    await expect(active).resolves.toBe('CLEAN_VERIFIED');
    await expect(
      runSyntheticCampaign(directory, 'comma-csv', send),
    ).rejects.toThrow('BUDGET_CLOSED');
    await expect(
      runSyntheticCampaign(
        directory,
        'semicolon-csv',
        async () => 'PROVIDER_BLOCKED',
      ),
    ).resolves.toBe('PROVIDER_BLOCKED');
    await expect(
      runSyntheticCampaign(directory, 'semicolon-csv', send),
    ).rejects.toThrow('BUDGET_CLOSED');
    expect(send).toHaveBeenCalledTimes(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('requires a trusted certificate and hostname and never follows redirects with the key', async () => {
  const cert = await generate([{ name: 'commonName', value: 'fixture.test' }], {
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'fixture.test' }],
      },
    ],
  });
  let leaked = 0;
  const sink = createHttpServer((_req, res) => {
    leaked++;
    res.writeHead(500).end();
  });
  const sinkListening = once(sink, 'listening');
  sink.listen(0, '127.0.0.1');
  await sinkListening;
  const target = sink.address();
  if (!target || typeof target === 'string')
    throw new Error('Sink unavailable');
  let calls = 0;
  const server = createServer(
    { key: cert.private, cert: cert.cert },
    (req, res) => {
      calls++;
      expect(req.url).toBe('/virus/scan/file/advanced');
      expect(req.headers.apikey).toBe('test-key');
      req.resume();
      res
        .writeHead(307, { Location: `http://127.0.0.1:${target.port}/leak` })
        .end();
    },
  );
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  const publicRoots = createDirectTlsAgent();
  const testRoots = createDirectTlsAgent(cert.cert);
  try {
    await listening;
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Mock unavailable');
    const scan = (agent: typeof publicRoots, servername: string) =>
      requestAdvanced(
        (opts, callback) =>
          request(
            {
              ...opts,
              hostname: '127.0.0.1',
              port: address.port,
              servername,
              agent,
            },
            callback,
          ),
        'test-key',
        Buffer.from('name,value\nfixture,1\n'),
        'csv',
      );
    await expect(scan(publicRoots, 'fixture.test')).resolves.toBe('SCAN_ERROR');
    await expect(scan(testRoots, 'wrong.test')).resolves.toBe('SCAN_ERROR');
    expect(calls).toBe(0);
    await expect(scan(testRoots, 'fixture.test')).resolves.toBe('SCAN_ERROR');
    expect(calls).toBe(1);
    expect(leaked).toBe(0);
  } finally {
    publicRoots.destroy();
    testRoots.destroy();
    server.close();
    server.closeAllConnections();
    sink.close();
    sink.closeAllConnections();
  }
});
