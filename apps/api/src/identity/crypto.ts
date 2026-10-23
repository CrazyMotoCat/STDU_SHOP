import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { StaffError } from './errors.js';

const argonProfile = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  saltLength: 16,
  hashLength: 32,
} as const;

function inspectPhc(value: string): boolean {
  const match =
    /^\$argon2id\$v=19\$([^$]+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(
      value,
    );
  if (!match) return false;
  const parameters = new Map<string, number>();
  for (const part of (match[1] ?? '').split(',')) {
    const parameter = /^(m|t|p)=([0-9]+)$/.exec(part);
    if (!parameter || parameters.has(parameter[1]!)) return false;
    parameters.set(parameter[1]!, Number(parameter[2]));
  }
  if (parameters.size !== 3) return false;
  const memory = parameters.get('m') ?? 0;
  const time = parameters.get('t') ?? 0;
  const parallelism = parameters.get('p') ?? 0;
  const salt = Buffer.from(match[2] ?? '', 'base64');
  const digest = Buffer.from(match[3] ?? '', 'base64');
  return (
    memory >= 65_536 &&
    memory <= 262_144 &&
    time >= 3 &&
    time <= 5 &&
    parallelism >= 1 &&
    parallelism <= 4 &&
    salt.toString('base64').replace(/=+$/, '') === match[2] &&
    digest.toString('base64').replace(/=+$/, '') === match[3] &&
    salt.length >= 16 &&
    salt.length <= 64 &&
    digest.length >= 32 &&
    digest.length <= 64
  );
}

interface WaitingTask {
  settled: boolean;
  start: () => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

@Injectable()
export class IdentityCrypto {
  private active = 0;
  private readonly waiting: WaitingTask[] = [];
  private dummyHash: string | null = null;

  async initialize() {
    if (!this.dummyHash)
      this.dummyHash = await this.run(() =>
        argon2.hash(randomBytes(32).toString('hex'), argonProfile),
      );
  }

  async hashPassword(password: string, emailNormalized?: string) {
    validatePassword(password, emailNormalized);
    return this.run(() => argon2.hash(password, argonProfile));
  }

  async verify(passwordHash: string, password: string) {
    if (!inspectPhc(passwordHash)) return false;
    return this.run(() => argon2.verify(passwordHash, password));
  }

  async verifyDummy(password: string) {
    await this.initialize();
    return this.verify(this.dummyHash!, password);
  }

  isUsableHash(value: string) {
    return inspectPhc(value);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active < 2) return this.start(operation);
    if (this.waiting.length >= 16)
      return Promise.reject(new StaffError('DEPENDENCY_UNAVAILABLE'));
    return new Promise<T>((resolve, reject) => {
      const task: WaitingTask = {
        settled: false,
        reject,
        start: () => {
          if (task.settled) return;
          task.settled = true;
          if (task.timer) clearTimeout(task.timer);
          this.start(operation).then(resolve, reject);
        },
      };
      task.timer = setTimeout(() => {
        if (task.settled) return;
        task.settled = true;
        task.reject(new StaffError('DEPENDENCY_UNAVAILABLE'));
      }, 2000);
      this.waiting.push(task);
    });
  }

  private async start<T>(operation: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await operation();
    } catch {
      throw new StaffError('DEPENDENCY_UNAVAILABLE');
    } finally {
      this.active--;
      let next = this.waiting.shift();
      while (next?.settled) next = this.waiting.shift();
      next?.start();
    }
  }
}

export function validatePassword(password: string, emailNormalized?: string) {
  const codePoints = Array.from(password).length;
  const bytes = Buffer.byteLength(password, 'utf8');
  if (
    codePoints < 15 ||
    codePoints > 128 ||
    bytes > 512 ||
    (emailNormalized !== undefined && password === emailNormalized)
  ) {
    throw new StaffError('VALIDATION_ERROR', [
      { field: 'password', code: 'PASSWORD_POLICY' },
    ]);
  }
}

export function rawSessionToken() {
  const raw = randomBytes(32);
  return {
    raw,
    encoded: raw.toString('base64url'),
    hash: createHash('sha256').update(raw).digest(),
  };
}

export function decodeSessionToken(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== value) return null;
  return raw;
}

export function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest();
}

export function hmac(key: Buffer, value: string | Buffer) {
  return createHmac('sha256', key).update(value).digest();
}

export function csrfToken(
  key: Buffer,
  purpose: 'login-csrf-v1' | 'staff-csrf-v1',
  binding: string,
) {
  return createHmac('sha256', key)
    .update(`${purpose}\0${binding}`, 'utf8')
    .digest('base64url');
}

export function loginCsrfBinding(rawChallenge: Buffer) {
  return sha256(rawChallenge).toString('hex');
}

export function staffCsrfBinding(sessionId: string, rawSessionToken: Buffer) {
  return `${sessionId}\0${sha256(rawSessionToken).toString('hex')}`;
}

export function matchesToken(expected: string, supplied: string | undefined) {
  if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) return false;
  const expectedBytes = Buffer.from(expected, 'base64url');
  const suppliedBytes = Buffer.from(supplied, 'base64url');
  if (
    expectedBytes.length !== 32 ||
    suppliedBytes.length !== 32 ||
    suppliedBytes.toString('base64url') !== supplied
  )
    return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validEmail(value: string) {
  return (
    value.length <= 254 &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      value,
    )
  );
}

export function usableCredential(
  hash: string,
  passwordChangeRequired: boolean,
) {
  return inspectPhc(hash) && !passwordChangeRequired;
}
