import { describe, expect, it, vi } from 'vitest';
import { commandAttempt } from './model';

describe('manual apply command retry identity', () => {
  const path = '/v1/staff/ingestion/rows/TEST/apply';
  const body = { offerId: 'TEST-offer', expectedOfferVersion: 3 };

  it('preserves the command key after an ambiguous network failure', () => {
    const create = vi
      .fn()
      .mockReturnValueOnce('first-key')
      .mockReturnValueOnce('new-key');
    const original = commandAttempt(null, path, body, create);
    const retry = commandAttempt(original, path, { ...body }, create);
    expect(retry.key).toBe(original.key);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('uses a new command after explicit review of a changed version or target', () => {
    const create = vi
      .fn()
      .mockReturnValueOnce('first-key')
      .mockReturnValueOnce('version-key')
      .mockReturnValueOnce('target-key');
    const original = commandAttempt(null, path, body, create);
    const refreshed = commandAttempt(
      original,
      path,
      { ...body, expectedOfferVersion: 4 },
      create,
    );
    expect(refreshed.key).toBe('version-key');
    const target = commandAttempt(
      refreshed,
      path,
      { ...body, offerId: 'another-offer' },
      create,
    );
    expect(target.key).toBe('target-key');
  });
});
