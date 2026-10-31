import type { ServerResponse } from 'node:http';

export async function waitWithAbort<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted)
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Private scan request was aborted.');

  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Private scan request was aborted.'),
          );
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export function endResponseBounded(
  response: ServerResponse,
  timeoutMs = 5_000,
): Promise<void> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1)
    return Promise.reject(new Error('Response completion timeout is invalid.'));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      response.removeListener('finish', onFinish);
      response.removeListener('close', onClose);
      response.removeListener('error', onError);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onFinish = () => settle();
    const onClose = () =>
      settle(
        response.writableFinished
          ? undefined
          : new Error('Private scan response closed before finish.'),
      );
    const onError = (error: Error) => settle(error);
    const timer = setTimeout(() => {
      response.destroy();
      settle(new Error('Private scan response completion timed out.'));
    }, timeoutMs);

    response.once('finish', onFinish);
    response.once('close', onClose);
    response.once('error', onError);
    try {
      response.end();
    } catch (error) {
      settle(
        error instanceof Error
          ? error
          : new Error('Private scan response failed to end.'),
      );
    }
  });
}

export function waitForResponseDrain(response: ServerResponse): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      response.removeListener('drain', onDrain);
      response.removeListener('close', onClose);
      response.removeListener('error', onError);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onDrain = () => settle();
    const onClose = () =>
      settle(new Error('Private scan stream consumer closed early.'));
    const onError = (error: Error) => settle(error);

    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
    if (response.destroyed || response.writableEnded) onClose();
  });
}
