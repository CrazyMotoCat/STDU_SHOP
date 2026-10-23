import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { IdentityCrypto } from '../src/identity/crypto.js';
import {
  CATALOG_PERMISSION_CODES,
  assertAdminInvariants,
} from '../src/permissions/policy.js';

const apiRoot = process.cwd();
const repoRoot = resolve(apiRoot, '../..');
const require = createRequire(resolve(repoRoot, 'package.json'));
const tsxCli = require.resolve('tsx/cli');
const cliEntry = resolve(apiRoot, 'scripts/catalog-permissions.ts');
const targetId = randomUUID();
const ineligibleId = randomUUID();
const emailTag = randomUUID().replaceAll('-', '').slice(0, 12);
const dbUrl = process.env.STAFF_DATABASE_URL ?? process.env.DATABASE_URL;
assert(dbUrl, 'The owned initializer harness requires DATABASE_URL.');

function cli(args: string[]) {
  return new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [tsxCli, cliEntry, ...args], {
      cwd: apiRoot,
      env: {
        ...process.env,
        APP_ENV: 'development',
        DATABASE_URL: dbUrl,
        STAFF_DATABASE_URL: dbUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function expectFailure(args: string[], expectedCode: string) {
  const result = await cli(args);
  assert.equal(result.timedOut, false, 'The initializer process timed out.');
  assert.equal(result.code, 1, result.stderr || result.stdout);
  assert.match(result.stderr, new RegExp(expectedCode));
}

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: dbUrl }),
  });
  try {
    const adminRole = await db.role.findUnique({
      where: { code: 'bootstrap-admin' },
      select: { id: true },
    });
    assert(adminRole, 'The isolated migration must create bootstrap-admin.');
    const passwordHash = await new IdentityCrypto().hashPassword(
      'R1-004B isolated initializer fixture password',
      `admin-${emailTag}@example.invalid`,
    );
    await db.staffUser.createMany({
      data: [
        {
          id: targetId,
          email: `admin-${emailTag}@example.invalid`,
          emailNormalized: `admin-${emailTag}@example.invalid`,
          displayName: 'Isolated catalog initializer admin',
          passwordHash,
          passwordChangeRequired: false,
          state: 'ACTIVE',
        },
        {
          id: ineligibleId,
          email: `forced-${emailTag}@example.invalid`,
          emailNormalized: `forced-${emailTag}@example.invalid`,
          displayName: 'Isolated forced change user',
          passwordHash,
          passwordChangeRequired: true,
          state: 'ACTIVE',
        },
      ],
    });
    await db.userRole.createMany({
      data: [
        { staffUserId: targetId, roleId: adminRole.id },
        { staffUserId: ineligibleId, roleId: adminRole.id },
      ],
    });

    const targetArgs = [
      '--target-user-id',
      targetId,
      '--operator',
      'r1-004b-test',
    ];
    await expectFailure(targetArgs, 'OWNER_APPROVAL_REQUIRED');
    await expectFailure(
      [
        '--target-user-id',
        ineligibleId,
        '--owner-approval-ref',
        'R1-004B-TEST',
        '--operator',
        'r1-004b-test',
      ],
      'TARGET_NOT_ELIGIBLE',
    );
    await expectFailure(
      [
        '--target-user-id',
        targetId,
        '--owner-approval-ref',
        'contains spaces',
        '--operator',
        'r1-004b-test',
      ],
      'VALIDATION_ERROR',
    );

    const futurePermissionId = randomUUID();
    await db.permission.create({
      data: {
        id: futurePermissionId,
        code: 'catalog.future.write',
        description: 'Test only.',
      },
    });
    await expectFailure(
      [
        ...targetArgs.slice(0, 2),
        '--owner-approval-ref',
        'R1-004B-TEST',
        ...targetArgs.slice(2),
      ],
      'DEPENDENCY_UNAVAILABLE',
    );
    await db.permission.delete({ where: { id: futurePermissionId } });

    await db.$executeRawUnsafe(`CREATE FUNCTION fail_catalog_initializer_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'catalog.permissions.initialized' AND NEW.outcome = 'SUCCESS' THEN
          RAISE EXCEPTION 'controlled catalog initializer audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_catalog_initializer_audit
      BEFORE INSERT ON audit_event FOR EACH ROW
      EXECUTE FUNCTION fail_catalog_initializer_audit()`);
    await expectFailure(
      [
        ...targetArgs.slice(0, 2),
        '--owner-approval-ref',
        'R1-004B-TEST',
        ...targetArgs.slice(2),
      ],
      'INTERNAL_ERROR',
    );
    await db.$executeRawUnsafe(
      `DROP TRIGGER fail_catalog_initializer_audit ON audit_event`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION fail_catalog_initializer_audit()`,
    );
    assert.equal(
      await db.role.count({
        where: { code: { startsWith: 'catalog-bootstrap-' } },
      }),
      0,
      'Role creation must roll back when success audit fails.',
    );
    assert.equal(
      await db.userRole.count({
        where: {
          staffUserId: targetId,
          role: { code: { startsWith: 'catalog-bootstrap-' } },
        },
      }),
      0,
      'User assignment must roll back when success audit fails.',
    );

    const initArgs = [
      '--target-user-id',
      targetId,
      '--owner-approval-ref',
      'R1-004B-TEST',
      '--operator',
      'r1-004b-test',
    ];
    const concurrent = await Promise.all([cli(initArgs), cli(initArgs)]);
    assert(concurrent.every((result) => !result.timedOut));
    assert.deepEqual(
      concurrent.map((result) => result.code).sort(),
      [0, 1],
      concurrent.map((result) => result.stderr || result.stdout).join('\n'),
    );
    const successful = concurrent.find((result) => result.code === 0)!;
    const rejected = concurrent.find((result) => result.code === 1)!;
    assert.match(rejected.stderr, /INITIAL_GRANT_ALREADY_USED/);
    const roleId = /roleId=([0-9a-f-]{36})/.exec(successful.stdout)?.[1];
    assert(roleId, 'Successful command must identify the created role.');

    const role = await db.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: { include: { permission: true } },
        assignments: true,
      },
    });
    assert(role);
    assert.equal(role.code.startsWith('catalog-bootstrap-'), true);
    assert.deepEqual(
      role.permissions.map(({ permission }) => permission.code).sort(),
      [...CATALOG_PERMISSION_CODES].sort(),
    );
    assert.deepEqual(
      role.assignments.map(({ staffUserId }) => staffUserId),
      [targetId],
    );
    assert.equal(
      await db.rolePermission.count({
        where: {
          role: { code: 'bootstrap-admin' },
          permission: { code: { startsWith: 'catalog.' } },
        },
      }),
      0,
      'The pre-existing bootstrap role must remain unchanged.',
    );

    const rows = await db.$queryRaw<{ code: string }[]>`
      SELECT DISTINCT p.code FROM user_role ur
      JOIN role r ON r.id=ur.role_id AND r.state='ACTIVE'
      JOIN role_permission rp ON rp.role_id=r.id
      JOIN permission p ON p.id=rp.permission_id
      WHERE ur.staff_user_id=${targetId}::uuid ORDER BY p.code
    `;
    const targetPermissions = rows.map(({ code }) => code);
    for (const code of CATALOG_PERMISSION_CODES)
      assert(targetPermissions.includes(code));
    await assertAdminInvariants(db as never);

    const outcomes = await db.auditEvent.findMany({
      where: { action: 'catalog.permissions.initialized' },
      orderBy: { occurredAt: 'asc' },
      select: {
        outcome: true,
        reasonCode: true,
        entityType: true,
        changes: true,
      },
    });
    assert.equal(
      outcomes.filter(({ outcome }) => outcome === 'SUCCESS').length,
      1,
      'Exactly one concurrent initializer may commit a success.',
    );
    assert(
      outcomes.some(
        ({ reasonCode }) => reasonCode === 'OWNER_APPROVAL_REQUIRED',
      ),
    );
    assert(
      outcomes.some(({ reasonCode }) => reasonCode === 'TARGET_NOT_ELIGIBLE'),
    );
    assert(
      outcomes.some(({ reasonCode }) => reasonCode === 'VALIDATION_ERROR'),
    );
    assert(
      outcomes.some(
        ({ reasonCode }) => reasonCode === 'DEPENDENCY_UNAVAILABLE',
      ),
    );
    assert(outcomes.some(({ reasonCode }) => reasonCode === 'INTERNAL_ERROR'));
    assert(
      outcomes.some(
        ({ reasonCode }) => reasonCode === 'INITIAL_GRANT_ALREADY_USED',
      ),
    );
    const success = outcomes.find(({ outcome }) => outcome === 'SUCCESS');
    assert.equal(success?.entityType, 'Role');
    assert.equal(
      (success?.changes as { approvalReference?: string }).approvalReference,
      'R1-004B-TEST',
    );
    console.log(
      'PASS isolated catalog permission initializer: validation, eligibility, fail-closed registry, audit rollback, exact role grant, preserved admin role, and concurrent one-time execution.',
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack : 'Initializer harness failed.',
  );
  process.exitCode = 1;
});
