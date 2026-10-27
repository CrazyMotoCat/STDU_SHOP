import { describe, expect, it } from 'vitest';
import {
  INQUIRY_UPLOAD_BUFFER_LIMITS,
  UploadMeter,
} from '../src/inquiries/inquiries.service.js';

describe('Inquiry upload stream memory bounds', () => {
  it('keeps duplex queues and parser byte buffers below the frozen 1 MiB cap', () => {
    const meter = new UploadMeter(1, 1, false, false, false);
    const conservativeBytes =
      INQUIRY_UPLOAD_BUFFER_LIMITS.readableQueueBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.writableQueueBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.retainedTailBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.retainedPrefixBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.pdfScanCarryBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.maxInputChunkBytes +
      INQUIRY_UPLOAD_BUFFER_LIMITS.pdfScanScratchBytes;

    expect(meter.readableHighWaterMark).toBe(
      INQUIRY_UPLOAD_BUFFER_LIMITS.readableQueueBytes,
    );
    expect(meter.writableHighWaterMark).toBe(
      INQUIRY_UPLOAD_BUFFER_LIMITS.writableQueueBytes,
    );
    expect(conservativeBytes).toBeLessThanOrEqual(
      INQUIRY_UPLOAD_BUFFER_LIMITS.maxApplicationBytesPerStream,
    );
    meter.destroy();
  });

  it('rejects a single upstream chunk larger than its fixed processing bound', async () => {
    const meter = new UploadMeter(
      INQUIRY_UPLOAD_BUFFER_LIMITS.maxInputChunkBytes + 1,
      INQUIRY_UPLOAD_BUFFER_LIMITS.maxInputChunkBytes + 1,
      false,
      false,
      false,
    );
    const failed = new Promise<Error>((resolve) =>
      meter.once('error', resolve),
    );
    meter.write(
      Buffer.alloc(INQUIRY_UPLOAD_BUFFER_LIMITS.maxInputChunkBytes + 1),
    );

    await expect(failed).resolves.toMatchObject({
      message: 'UPLOAD_CHUNK_LIMIT',
    });
    expect(meter.readableLength).toBe(0);
  });
});
