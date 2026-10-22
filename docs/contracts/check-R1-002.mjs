/** Documentation-only consistency gate. No DB, network, auth or migration code. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = process.argv[2]
  ? resolve(process.argv[2])
  : dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(readFileSync(resolve(directory, name), 'utf8'));
const model = read('R1-002-data-model.json');
const rbac = read('R1-002-rbac-matrix.json');
const api = read('R1-002-staff.openapi.json');
const audit = read('R1-002-audit-registry.json');
const version = '1.0.0';
assert.equal(model.status, 'FROZEN');
assert.equal(rbac.status, 'FROZEN');
assert.equal(api['x-status'], 'FROZEN');
assert.equal(audit.status, 'FROZEN');
for (const value of [
  model.version,
  rbac.version,
  api.info.version,
  api['x-contract-version'],
  audit.version,
])
  assert.equal(value, version);
for (const name of [
  'R1-002-auth-security.md',
  'R1-002-rbac-matrix.md',
  'R1-002-staff-data-model.md',
  'R1-002-test-matrix.md',
]) {
  assert(
    readFileSync(resolve(directory, name), 'utf8').includes(
      '**Статус: FROZEN. Версия: 1.0.0.',
    ),
    `Contract Markdown status/version drift: ${name}`,
  );
}
const entities = [
  'StaffUser',
  'Role',
  'Permission',
  'UserRole',
  'RolePermission',
  'StaffSession',
  'SellerLegalEntity',
  'AuditEvent',
  'FileObject',
  'FileVersion',
  'FileLink',
];
assert.deepEqual(Object.keys(model.tables), entities);
for (const [name, table] of Object.entries(model.tables)) {
  assert(table.purpose && table.lifecycle && table.future, name);
  assert(table.actions.length > 0, name);
  assert(table.primaryKey.length > 0, name);
  for (const key of table.primaryKey) {
    assert(table.fields[key], `${name}.${key} PK missing`);
    assert.equal(table.fields[key].nullable, false);
  }
  for (const [field, type] of Object.entries(table.fields)) {
    assert.equal(typeof type.nullable, 'boolean', `${name}.${field}`);
    assert.equal(typeof type.type, 'string');
    if (type.references) {
      const [target, column] = type.references.split('.');
      assert(model.tables[target]?.fields[column], type.references);
      assert.equal(type.onDelete, 'RESTRICT');
      assert.equal(type.onUpdate, 'RESTRICT');
    }
  }
}
assert.equal(model.tables.StaffSession.fields.tokenHash.bytes, 32);
assert.equal(model.tables.FileVersion.fields.sha256.bytes, 32);
assert.equal(model.tables.FileLink.fields.entityId, undefined);
assert.equal(
  model.tables.FileLink.fields.sellerLegalEntityId.references,
  'SellerLegalEntity.id',
);
assert(
  model.tables.FileLink.checks.some((check) => check.includes('COMPOSITE FK')),
);
assert(
  model.tables.StaffUser.unique.some((key) =>
    key.includes('emailNormalized COLLATE C'),
  ),
);
assert.equal(Object.keys(rbac.permissions).length, 12);
for (const [role, permissions] of Object.entries(rbac.roleTemplates)) {
  assert.equal(new Set(permissions).size, permissions.length, role);
  for (const permission of permissions)
    assert(rbac.permissions[permission], role);
}
for (const permission of rbac.controlAdminRequiredPermissions)
  assert(rbac.permissions[permission], permission);
// Deliberately fixed R1-002 set. Registering a future action must not extend it.
const protectedPermissions = [
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
assert.deepEqual(
  rbac.controlAdminRequiredPermissions,
  protectedPermissions.slice(0, 8),
);
assert.deepEqual(rbac.fullAdminProtectedPermissions, protectedPermissions);
assert.deepEqual(rbac.roleTemplates['bootstrap-admin'], protectedPermissions);
assert.deepEqual(
  rbac.roleTemplates['access-admin'],
  protectedPermissions.slice(0, 8),
);
assert.equal(rbac.roleTemplates['access-operator'], undefined);
const preservation = {
  controlRequiredSet: 'controlAdminRequiredPermissions',
  fullRequiredSet: 'fullAdminProtectedPermissions',
  minimumControlAdmins: 1,
  minimumFullAdmins: 1,
  qualification: {
    userState: 'ACTIVE',
    passwordChangeRequired: false,
    credential: 'valid policy-compliant Argon2id passwordHash',
    permissions: 'effective union of ACTIVE assigned roles for the same user',
    requiresLiveSession: false,
    roleNameAuthority: false,
  },
  lock: 'pg_advisory_xact_lock(1398031445, 2)',
  transaction:
    'READ COMMITTED; acquire advisory lock before reading authorization/invariant state; recompute both administrator sets from resulting persisted state before commit',
  writers: [
    'user.state',
    'user.credentials',
    'user.passwordChangeRequired',
    'user.roles',
    'role.permissions',
    'role.state',
    'permission.registry',
  ],
  failureCode: 'LAST_ADMIN_REQUIRED',
  failure:
    'rollback business rows, versions and session changes; no SUCCESS audit; separate mandatory DENIED audit with LAST_ADMIN_REQUIRED; audit failure returns 503',
  futurePermissions:
    'explicit versioned owner-approved contract update only; no automatic inclusion',
  privilegedBypass: false,
};
assert.deepEqual(rbac.adminPreservation, preservation);
assert.deepEqual(api['x-admin-preservation'], {
  ...preservation,
  controlAdminRequiredPermissions: protectedPermissions.slice(0, 8),
  fullAdminProtectedPermissions: protectedPermissions,
});
const invariantOperations = new Set([
  'changeMyPassword',
  'setStaffUserState',
  'assignStaffRole',
  'removeStaffRole',
  'changeRole',
  'replaceRolePermissions',
]);
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const operations = [];
for (const [path, item] of Object.entries(api.paths)) {
  assert(path.startsWith('/v1/staff/'), path);
  assert(!/download|upload|catalog|quotes|orders|warehouse/.test(path), path);
  for (const [method, operation] of Object.entries(item)) {
    assert(methods.has(method), method);
    operations.push(operation.operationId);
    const permission = operation['x-permission'];
    assert(permission === null || rbac.permissions[permission], path);
    assert(operation['x-audit'], path);
    const primaryAuditAction =
      operation['x-audit'].match(/^[a-z]+(?:\.[a-z]+)+/)?.[0];
    if (primaryAuditAction) {
      assert(audit.actions[primaryAuditAction], primaryAuditAction);
      for (const [status, response] of Object.entries(operation.responses))
        if (Number(status) >= 400 && Number(status) < 500)
          for (const code of response['x-error-codes'])
            assert(
              audit.actions[primaryAuditAction].outcomes.DENIED?.includes(code),
              `Audit denial not representable: ${operation.operationId}/${code}`,
            );
    }
    assert(Array.isArray(operation['x-invariants']), path);
    if (invariantOperations.has(operation.operationId)) {
      assert(
        operation['x-invariants'].some((rule) =>
          rule.startsWith('Apply x-admin-preservation:'),
        ),
        `Missing full administrator invariant: ${operation.operationId}`,
      );
      assert(
        operation.responses[409]?.['x-error-codes'].includes(
          'LAST_ADMIN_REQUIRED',
        ),
        `Missing preservation rejection: ${operation.operationId}`,
      );
    }
    assert(
      operation.responses[400] &&
        operation.responses[500] &&
        operation.responses[503],
      path,
    );
    if (!['login', 'getCsrf'].includes(operation.operationId)) {
      assert.deepEqual(operation.security, [{ staffCookie: [] }], path);
      assert(operation.responses[401] && operation.responses[403], path);
    }
    if (method !== 'get') {
      assert.notEqual(operation['x-csrf'], 'NONE');
      for (const header of ['Origin', 'X-CSRF-Token'])
        assert(
          operation.parameters.some(
            (p) => p.in === 'header' && p.name === header && p.required,
          ),
          path,
        );
      if (!path.includes('/auth/'))
        for (const [code, response] of Object.entries(operation.responses))
          if (Number(code) < 300)
            assert.equal(
              response.content['application/json'].schema.$ref,
              '#/components/schemas/MutationResponse',
              'Write permission disclosed read DTO',
            );
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      assert(response.headers['X-Request-Id'], `${path} ${status}`);
      assert(response.headers['Cache-Control'], `${path} ${status}`);
      if (Number(status) >= 400)
        assert(
          response['x-error-codes'].every((code) =>
            api.components.schemas.Error.properties.code.enum.includes(code),
          ),
        );
    }
  }
}
assert(
  api.paths['/v1/staff/auth/me/password'].put.responses[429],
  'Password verification limiter missing',
);
assert.equal(
  api.components.schemas.StaffUser.properties.roleIds.maxItems,
  undefined,
  'Unenforced role assignment cap',
);
for (const [action, definition] of Object.entries(audit.actions)) {
  assert(/^[a-z]+(?:\.[a-z]+)+$/.test(action), action);
  for (const [outcome, reasons] of Object.entries(definition.outcomes)) {
    assert(['SUCCESS', 'DENIED', 'FAILURE'].includes(outcome), outcome);
    assert(reasons.length > 0, action);
    if (outcome !== 'SUCCESS') assert(!reasons.includes(null), action);
  }
  for (const key of definition.changesKeys)
    assert(
      api.components.schemas.AuditChanges.properties[key],
      `Unknown audit key ${key}`,
    );
}
assert.deepEqual(
  api.components.schemas.AuditEvent.properties.action.enum,
  Object.keys(audit.actions),
);
for (const reason of audit.sessionRevocationReasons)
  assert(
    audit.actions['staff.sessions.revoked'].outcomes.SUCCESS.includes(reason),
  );
for (const reason of audit.recoveryCliReasons)
  assert(
    audit.actions['staff.access.recovered'].outcomes.SUCCESS.includes(reason),
  );
assert.equal(operations.length, 23);
assert.equal(new Set(operations).size, operations.length);
for (const name of Object.keys(rbac.permissions))
  assert(
    Object.values(api.paths).some((item) =>
      Object.values(item).some((op) => op['x-permission'] === name),
    ),
    name,
  );
assert.deepEqual(
  api.components.schemas.PermissionCode.enum,
  Object.keys(rbac.permissions),
);
const deref = (reference) => {
  assert(reference.startsWith('#/'), 'External references forbidden');
  const found = reference
    .slice(2)
    .split('/')
    .reduce(
      (value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')],
      api,
    );
  assert(found, `Unresolved ${reference}`);
  return found;
};
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.$ref) deref(value.$ref);
  if (value.type === 'object') {
    assert.equal(value.additionalProperties, false, 'Open DTO object');
    for (const required of value.required ?? [])
      assert(value.properties[required], required);
  }
  for (const child of Object.values(value)) walk(child);
}
walk(api);
function checkResponse(schema, seen = new Set()) {
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return;
    seen.add(schema.$ref);
    return checkResponse(deref(schema.$ref), seen);
  }
  for (const [field, child] of Object.entries(schema.properties ?? {})) {
    assert(
      !/passwordHash|tokenHash|storageKey|sourceHash|currentPassword|initialPassword|newPassword|sessionToken/i.test(
        field,
      ),
      `Secret response ${field}`,
    );
    assert(!child.writeOnly, `Write-only response ${field}`);
    checkResponse(child, seen);
  }
  if (schema.items) checkResponse(schema.items, seen);
}
for (const item of Object.values(api.paths))
  for (const operation of Object.values(item))
    for (const response of Object.values(operation.responses))
      checkResponse(response.content['application/json'].schema);
const testMatrix = readFileSync(
  resolve(directory, 'R1-002-test-matrix.md'),
  'utf8',
);
for (let n = 1; n <= 40; n++)
  assert(
    testMatrix.includes(`| T-${String(n).padStart(2, '0')} |`),
    `Missing test T-${n}`,
  );
console.log(
  'PASS FROZEN R1-002 1.0.0: 11 entities, 12 permissions, 23 operations, 40 planned tests; full-admin preservation/references/DTO/CSRF/permission consistency. No runtime or SQL verification claimed.',
);
