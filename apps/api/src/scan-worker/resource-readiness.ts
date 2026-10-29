import { ScanProtocolError } from '../inquiries/scan-protocol.js';

export interface ResourceSnapshot {
  readonly instance: string;
  readonly measuredAt: number;
  readonly scratchAvailableBytes: number;
  readonly oom: number;
  readonly oomKill: number;
}

const MIN_SCRATCH_BYTES = 384 * 1024 * 1024;
const MAX_REPLY_BYTES = 4096;
const MAX_AGE_MS = 5000;

export function parseResourceSnapshot(
  value: unknown,
  now = Date.now(),
): ResourceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
  const record = value as Record<string, unknown>;
  const keys = [
    'instance',
    'measuredAt',
    'scratchAvailableBytes',
    'oom',
    'oomKill',
    'ready',
  ];
  if (
    Object.keys(record).sort().join(',') !== keys.sort().join(',') ||
    record.ready !== true ||
    typeof record.instance !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:[0-9]+:[0-9]+$/.test(
      record.instance,
    ) ||
    !Number.isSafeInteger(record.measuredAt) ||
    !Number.isSafeInteger(record.scratchAvailableBytes) ||
    !Number.isSafeInteger(record.oom) ||
    !Number.isSafeInteger(record.oomKill)
  )
    throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
  const measuredAt = record.measuredAt as number;
  const scratchAvailableBytes = record.scratchAvailableBytes as number;
  const oom = record.oom as number;
  const oomKill = record.oomKill as number;
  if (
    measuredAt > now ||
    now - measuredAt > MAX_AGE_MS ||
    scratchAvailableBytes < MIN_SCRATCH_BYTES ||
    scratchAvailableBytes > 512 * 1024 * 1024 ||
    oom !== 0 ||
    oomKill !== 0
  )
    throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
  return {
    instance: record.instance,
    measuredAt,
    scratchAvailableBytes,
    oom,
    oomKill,
  };
}

export async function readResourceSnapshot(
  deadlineAt: number,
): Promise<ResourceSnapshot> {
  const host = process.env.CLAMD_HOST?.trim();
  const port = Number(process.env.SCAN_RESOURCE_PORT ?? '3311');
  const remaining = Math.min(2000, deadlineAt - Date.now());
  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    remaining <= 0
  )
    throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
  try {
    const response = await fetch(`http://${host}:${port}/ready`, {
      signal: AbortSignal.timeout(remaining),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('unavailable');
    }
    if (!response.body) throw new Error('unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > MAX_REPLY_BYTES) throw new Error('oversized');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return parseResourceSnapshot(
      JSON.parse(Buffer.concat(chunks).toString('utf8')),
    );
  } catch {
    throw new ScanProtocolError('SCANNER_UNAVAILABLE', true);
  }
}

export function resourceSnapshotsMatch(
  start: ResourceSnapshot,
  end: ResourceSnapshot,
): boolean {
  return (
    start.instance === end.instance &&
    end.measuredAt >= start.measuredAt &&
    start.oom === end.oom &&
    start.oomKill === end.oomKill
  );
}
