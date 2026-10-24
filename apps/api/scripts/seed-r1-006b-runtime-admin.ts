import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { IdentityCrypto } from '../src/identity/crypto.js';

const url = process.env.MIGRATION_DATABASE_URL;
const email = process.env.R1_006B_TEST_ADMIN_EMAIL;
const password = process.env.R1_006B_TEST_ADMIN_PASSWORD;
if (!url || !email || !password)
  throw new Error('Disposable R1-006B test environment is incomplete.');

const permissions = [
  'staff.users.read',
  'staff.users.create',
  'staff.users.status.write',
  'staff.sessions.revoke',
  'staff.roles.read',
  'staff.roles.write',
  'staff.roles.permissions.write',
  'staff.roles.assign',
  'sellers.read',
  'sellers.write',
  'audit.read',
  'files.metadata.read',
];
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
});
try {
  const userId = randomUUID();
  const passwordHash = await new IdentityCrypto().hashPassword(password, email);
  await db.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        id: randomUUID(),
        code: `r1006b-owner-${randomUUID().slice(0, 8)}`,
        name: 'R1-006B disposable runtime owner',
        state: 'ACTIVE',
      },
    });
    const registered = await tx.permission.findMany({
      where: { code: { in: permissions } },
      select: { id: true, code: true },
    });
    if (registered.length !== permissions.length)
      throw new Error('Frozen owner permission fixture is incomplete.');
    await tx.rolePermission.createMany({
      data: registered.map(({ id }) => ({ roleId: role.id, permissionId: id })),
    });
    await tx.staffUser.create({
      data: {
        id: userId,
        email,
        emailNormalized: email.toLowerCase(),
        displayName: 'Disposable R1-006B Runtime Owner',
        passwordHash,
        passwordChangeRequired: false,
        state: 'ACTIVE',
      },
    });
    await tx.userRole.create({
      data: { staffUserId: userId, roleId: role.id },
    });
  });
  process.stdout.write(userId);
} finally {
  await db.$disconnect();
}
