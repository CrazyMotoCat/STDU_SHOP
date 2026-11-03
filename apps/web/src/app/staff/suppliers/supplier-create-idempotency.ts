export type SupplierCreateAttemptStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export type SupplierCreateAttempt = {
  idempotencyKey: string;
  bodyHash: string;
};

export type SupplierCreateAttemptDecision =
  | { kind: 'new' | 'retry'; idempotencyKey: string; bodyHash: string }
  | { kind: 'replacement-required'; bodyHash: string };

const storagePrefix = 'stdu.staff.suppliers.create.v1';
const validKey = /^staff-[0-9a-f-]{36}$/i;
const validHash = /^[0-9a-f]{64}$/i;

function storageKey(actorId: string) {
  return `${storagePrefix}:${actorId}`;
}

async function hashBody(body: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function readAttempt(
  actorId: string,
  storage: SupplierCreateAttemptStorage,
): SupplierCreateAttempt | null {
  const key = storageKey(actorId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    throw new Error('Не удалось сохранить безопасный повтор операции.');
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      throw new Error('Не удалось очистить состояние повтора операции.');
    }
    return null;
  }

  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'idempotencyKey' in parsed &&
    typeof parsed.idempotencyKey === 'string' &&
    validKey.test(parsed.idempotencyKey) &&
    'bodyHash' in parsed &&
    typeof parsed.bodyHash === 'string' &&
    validHash.test(parsed.bodyHash)
  ) {
    return {
      idempotencyKey: parsed.idempotencyKey,
      bodyHash: parsed.bodyHash,
    };
  }

  try {
    storage.removeItem(key);
  } catch {
    throw new Error('Не удалось очистить состояние повтора операции.');
  }
  return null;
}

function writeAttempt(
  actorId: string,
  attempt: SupplierCreateAttempt,
  storage: SupplierCreateAttemptStorage,
) {
  try {
    storage.setItem(storageKey(actorId), JSON.stringify(attempt));
  } catch {
    throw new Error('Не удалось сохранить безопасный повтор операции.');
  }
}

function createAttempt(
  actorId: string,
  bodyHash: string,
  storage: SupplierCreateAttemptStorage,
  createKey: () => string,
) {
  const idempotencyKey = createKey();
  if (!validKey.test(idempotencyKey))
    throw new Error('Не удалось подготовить ключ повтора операции.');
  writeAttempt(actorId, { idempotencyKey, bodyHash }, storage);
  return { kind: 'new' as const, idempotencyKey, bodyHash };
}

export async function prepareSupplierCreateAttempt(
  actorId: string,
  body: string,
  storage: SupplierCreateAttemptStorage,
  createKey: () => string = () => `staff-${crypto.randomUUID()}`,
): Promise<SupplierCreateAttemptDecision> {
  if (!actorId) throw new Error('Не удалось определить сотрудника.');
  const bodyHash = await hashBody(body);
  const stored = readAttempt(actorId, storage);
  if (!stored) return createAttempt(actorId, bodyHash, storage, createKey);
  if (stored.bodyHash === bodyHash)
    return {
      kind: 'retry',
      idempotencyKey: stored.idempotencyKey,
      bodyHash,
    };
  return { kind: 'replacement-required', bodyHash };
}

export function replaceSupplierCreateAttempt(
  actorId: string,
  bodyHash: string,
  storage: SupplierCreateAttemptStorage,
  createKey: () => string = () => `staff-${crypto.randomUUID()}`,
) {
  if (!actorId || !validHash.test(bodyHash))
    throw new Error('Не удалось подготовить новый запрос поставщика.');
  return createAttempt(actorId, bodyHash, storage, createKey);
}

export function clearSupplierCreateAttempt(
  actorId: string,
  storage: SupplierCreateAttemptStorage,
) {
  try {
    storage.removeItem(storageKey(actorId));
    return true;
  } catch {
    return false;
  }
}

export function runSupplierCreateSingleFlight<T>(
  lock: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<T> {
  if (lock.current) return lock.current;

  const pending = Promise.resolve().then(operation);
  lock.current = pending;
  void pending.then(
    () => {
      if (lock.current === pending) lock.current = null;
    },
    () => {
      if (lock.current === pending) lock.current = null;
    },
  );
  return pending;
}
