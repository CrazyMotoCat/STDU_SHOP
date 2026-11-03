import { describe, expect, it } from 'vitest';
import {
  prepareSupplierCreateAttempt,
  replaceSupplierCreateAttempt,
  runSupplierCreateSingleFlight,
  type SupplierCreateAttemptStorage,
} from './supplier-create-idempotency.js';

class MemoryStorage implements SupplierCreateAttemptStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('supplier create idempotency', () => {
  it('reuses the same key and body after an uncertain result without storing supplier data', async () => {
    const storage = new MemoryStorage();
    const body = JSON.stringify({
      legalName: 'Private Supplier',
      taxIdentifier: '7707083893',
    });
    const keys = [
      'staff-11111111-1111-4111-8111-111111111111',
      'staff-22222222-2222-4222-8222-222222222222',
    ];
    const createKey = () => keys.shift()!;

    const first = await prepareSupplierCreateAttempt(
      'actor-a',
      body,
      storage,
      createKey,
    );
    if (first.kind !== 'new')
      throw new Error('Expected a new supplier attempt.');
    const retry = await prepareSupplierCreateAttempt(
      'actor-a',
      body,
      storage,
      createKey,
    );

    expect(first.kind).toBe('new');
    expect(retry).toMatchObject({
      kind: 'retry',
      idempotencyKey: first.idempotencyKey,
    });
    expect(
      storage.getItem('stdu.staff.suppliers.create.v1:actor-a'),
    ).not.toContain('Private Supplier');
    expect(
      storage.getItem('stdu.staff.suppliers.create.v1:actor-a'),
    ).not.toContain('7707083893');
  });

  it('keeps the prior key untouched when the body changes and replaces only after explicit choice', async () => {
    const storage = new MemoryStorage();
    const first = await prepareSupplierCreateAttempt(
      'actor-a',
      JSON.stringify({ legalName: 'Original' }),
      storage,
      () => 'staff-11111111-1111-4111-8111-111111111111',
    );
    const changed = await prepareSupplierCreateAttempt(
      'actor-a',
      JSON.stringify({ legalName: 'Edited' }),
      storage,
      () => 'staff-22222222-2222-4222-8222-222222222222',
    );
    const replacement =
      changed.kind === 'replacement-required'
        ? replaceSupplierCreateAttempt(
            'actor-a',
            changed.bodyHash,
            storage,
            () => 'staff-33333333-3333-4333-8333-333333333333',
          )
        : changed;

    expect(first.kind).toBe('new');
    expect(changed.kind).toBe('replacement-required');
    expect(replacement).toMatchObject({
      kind: 'new',
      idempotencyKey: 'staff-33333333-3333-4333-8333-333333333333',
    });
    expect(storage.getItem('stdu.staff.suppliers.create.v1:actor-a')).toContain(
      'staff-33333333-3333-4333-8333-333333333333',
    );
  });

  it('does not reuse a pending key across staff identities', async () => {
    const storage = new MemoryStorage();
    const first = await prepareSupplierCreateAttempt(
      'actor-a',
      '{"legalName":"Same supplier"}',
      storage,
      () => 'staff-11111111-1111-4111-8111-111111111111',
    );
    const second = await prepareSupplierCreateAttempt(
      'actor-b',
      '{"legalName":"Same supplier"}',
      storage,
      () => 'staff-22222222-2222-4222-8222-222222222222',
    );

    expect(first.kind).toBe('new');
    expect(second).toMatchObject({
      kind: 'new',
      idempotencyKey: 'staff-22222222-2222-4222-8222-222222222222',
    });
  });

  it('shares one in-flight create operation for double-submit', async () => {
    const lock: { current: Promise<number> | null } = { current: null };
    let calls = 0;
    let finish!: (value: number) => void;
    const operation = () => {
      calls += 1;
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    };

    const first = runSupplierCreateSingleFlight(lock, operation);
    const second = runSupplierCreateSingleFlight(lock, operation);
    await Promise.resolve();
    expect(calls).toBe(1);
    finish(201);

    await expect(Promise.all([first, second])).resolves.toEqual([201, 201]);
    expect(lock.current).toBeNull();
  });
});
