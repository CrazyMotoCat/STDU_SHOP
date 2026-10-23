/** Tests the documentation checker with disposable contract copies, not Staff API. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = dirname(fileURLToPath(import.meta.url));
const names = [
  'R1-002-data-model.json',
  'R1-002-rbac-matrix.json',
  'R1-002-staff.openapi.json',
  'R1-002-test-matrix.md',
  'R1-002-audit-registry.json',
  'R1-002-auth-security.md',
  'R1-002-rbac-matrix.md',
  'R1-002-staff-data-model.md',
  'R1-004-catalog-rbac-matrix.json',
];
const changeRegistry = (directory, mutate) => {
  const path = join(directory, names[4]);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
};
const changeRbac = (directory, mutate) => {
  const path = join(directory, names[1]);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  mutate(value);
  writeFileSync(path, JSON.stringify(value));
};
const cases = [
  ['baseline', () => {}, 0],
  [
    'unfrozen OpenAPI',
    (a) => {
      a['x-status'] = 'PROPOSED';
    },
  ],
  [
    'wrong contract version',
    (a) => {
      a.info.version = '0.1.0-proposed';
    },
  ],
  [
    'OpenAPI extension version drift',
    (a) => {
      a['x-contract-version'] = '0.1.0-proposed';
    },
  ],
  [
    'Markdown freeze drift',
    (_, d) => {
      const path = join(d, 'R1-002-rbac-matrix.md');
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace(
          'Статус: FROZEN.',
          'Статус: PROPOSED.',
        ),
      );
    },
  ],
  ['missing 401', (a) => delete a.paths['/v1/staff/users'].get.responses[401]],
  [
    'unknown permission',
    (a) => {
      a.paths['/v1/staff/users'].get['x-permission'] = 'catalog.publish';
    },
  ],
  [
    'missing additive catalog permission',
    (a) => a.components.schemas.PermissionCode.enum.pop(),
  ],
  [
    'unapproved additive permission',
    (a) => a.components.schemas.PermissionCode.enum.push('catalog.unapproved'),
  ],
  [
    'missing CSRF',
    (a) => {
      a.paths['/v1/staff/users'].post.parameters = a.paths[
        '/v1/staff/users'
      ].post.parameters.filter((p) => p.name !== 'X-CSRF-Token');
    },
  ],
  [
    'open DTO',
    (a) => {
      a.components.schemas.Me.additionalProperties = true;
    },
  ],
  [
    'credential response',
    (a) => {
      a.components.schemas.Me.properties.passwordHash = { type: 'string' };
    },
  ],
  [
    'anonymous protected route',
    (a) => {
      a.paths['/v1/staff/users'].get.security = [];
    },
  ],
  [
    'extra out-of-scope route',
    (a) => {
      a.paths['/v1/staff/catalog/products'] = {
        get: structuredClone(a.paths['/v1/staff/users'].get),
      };
    },
  ],
  [
    'write action leaking read DTO',
    (a) => {
      a.paths['/v1/staff/users'].post.responses[201].content[
        'application/json'
      ].schema = { $ref: '#/components/schemas/StaffUserListResponse' };
    },
  ],
  [
    'missing password limiter',
    (a) => delete a.paths['/v1/staff/auth/me/password'].put.responses[429],
  ],
  [
    'unenforced role cap',
    (a) => {
      a.components.schemas.StaffUser.properties.roleIds.maxItems = 100;
    },
  ],
  [
    'unsafe audit null',
    (_, directory) =>
      changeRegistry(directory, (r) =>
        r.actions['auth.login'].outcomes.DENIED.push(null),
      ),
  ],
  [
    'unrepresentable audit denial',
    (_, directory) =>
      changeRegistry(directory, (r) => {
        r.actions['staff.password.changed'].outcomes.DENIED = r.actions[
          'staff.password.changed'
        ].outcomes.DENIED.filter((code) => code !== 'VALIDATION_ERROR');
      }),
  ],
  [
    'missing full-admin protected set',
    (_, d) => changeRbac(d, (r) => delete r.fullAdminProtectedPermissions),
  ],
  [
    'control-only protected set',
    (_, d) =>
      changeRbac(d, (r) => {
        r.fullAdminProtectedPermissions = r.controlAdminRequiredPermissions;
      }),
  ],
  [
    'duplicate protected permission',
    (_, d) =>
      changeRbac(d, (r) => {
        r.fullAdminProtectedPermissions[11] = 'audit.read';
      }),
  ],
  [
    'bootstrap loses critical permission',
    (_, d) =>
      changeRbac(d, (r) => {
        r.roleTemplates['bootstrap-admin'].pop();
      }),
  ],
  [
    'role-name admin bypass',
    (_, d) =>
      changeRbac(d, (r) => {
        r.adminPreservation.qualification.roleNameAuthority = true;
      }),
  ],
  [
    'cross-user permission union',
    (_, d) =>
      changeRbac(d, (r) => {
        r.adminPreservation.qualification.permissions =
          'union across all users';
      }),
  ],
  [
    'privileged invariant bypass',
    (_, d) =>
      changeRbac(d, (r) => {
        r.adminPreservation.privilegedBypass = true;
      }),
  ],
  [
    'missing shared invariant lock',
    (_, d) =>
      changeRbac(d, (r) => {
        r.adminPreservation.lock = null;
      }),
  ],
  [
    'automatic future protected actions',
    (_, d) =>
      changeRbac(d, (r) => {
        r.adminPreservation.futurePermissions =
          'all registered actions automatically';
      }),
  ],
  [
    'OpenAPI admin policy drift',
    (a) => {
      a['x-admin-preservation'].minimumFullAdmins = 0;
    },
  ],
  [
    'missing mutation invariant',
    (a) => {
      a.paths['/v1/staff/roles/{roleId}'].patch['x-invariants'] = [];
    },
  ],
  [
    'missing preservation rejection',
    (a) => delete a.paths['/v1/staff/auth/me/password'].put.responses[409],
  ],
  [
    'missing full-admin regression',
    (_, d) => {
      const path = join(d, names[3]);
      writeFileSync(
        path,
        readFileSync(path, 'utf8').replace('| T-39 |', '| REMOVED |'),
      );
    },
  ],
];
for (const [label, mutate, expected = 1] of cases) {
  test(`documentation checker: ${label}`, (context) => {
    const directory = mkdtempSync(join(tmpdir(), 'stdu-contract-'));
    context.after(() => {
      // Only the literal names copied by this test, never recursive cleanup.
      for (const name of names) {
        try {
          unlinkSync(join(directory, name));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      rmdirSync(directory);
    });
    for (const name of names)
      copyFileSync(join(source, name), join(directory, name));
    const path = join(directory, names[2]);
    const api = JSON.parse(readFileSync(path, 'utf8'));
    mutate(api, directory);
    writeFileSync(path, JSON.stringify(api));
    const result = spawnSync(
      process.execPath,
      [join(source, 'check-R1-002.mjs'), directory],
      {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      },
    );
    assert.equal(
      result.status,
      expected,
      `${label}: ${result.error ?? result.stderr}`,
    );
  });
}
