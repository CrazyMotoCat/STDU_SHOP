import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOpenApi, readJson } from './openapi-contract.mjs';

const contract = await readJson('docs/contracts/R1-002-staff.openapi.json');
const generated = await readJson(
  '.local/contracts/generated-staff.openapi.json',
);
const frozenPermissionCodes = new Set(
  contract.components.schemas.PermissionCode.enum,
);
const supplierPermissionCodes = [
  'suppliers.read',
  'suppliers.write',
  'suppliers.offers.read',
  'suppliers.offers.write',
  'suppliers.matches.decide',
];

function visitPermissionEnums(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (
    Array.isArray(value.enum) &&
    value.enum.some((code) => frozenPermissionCodes.has(code))
  )
    visit(value.enum);
  for (const child of Object.values(value))
    if (child && typeof child === 'object') visitPermissionEnums(child, visit);
}

test('T-20: generated Nest OpenAPI equals the frozen contract', () => {
  assert.deepEqual(
    compareOpenApi(contract, generated, {
      allowedPermissionCodeAdditions: supplierPermissionCodes,
    }),
    {
      equal: true,
      differences: [],
    },
  );
});

test('checker rejects a removed authentication response', () => {
  const changed = structuredClone(generated);
  delete changed.paths['/v1/staff/users'].get.responses['401'];
  assert.equal(compareOpenApi(contract, changed).equal, false);
});

test('checker rejects a weakened required request field', () => {
  const changed = structuredClone(generated);
  changed.components.schemas.Login.required = ['email'];
  assert.equal(compareOpenApi(contract, changed).equal, false);
});

test('checker rejects an added permission', () => {
  const changed = structuredClone(generated);
  changed.components.schemas.PermissionCode.enum.push('catalog.write');
  assert.equal(compareOpenApi(contract, changed).equal, false);
});

test('checker permits only the approved supplier permission additions', () => {
  assert.equal(
    compareOpenApi(contract, generated, {
      allowedPermissionCodeAdditions: supplierPermissionCodes,
    }).equal,
    true,
  );
});

test('checker rejects any permission outside the approved supplier addition', () => {
  const changed = structuredClone(generated);
  visitPermissionEnums(changed, (values) => {
    if (!values.includes('catalog.write')) values.push('catalog.write');
  });
  assert.equal(
    compareOpenApi(contract, changed, {
      allowedPermissionCodeAdditions: supplierPermissionCodes,
    }).equal,
    false,
  );
});

test('checker rejects a runtime Permission enum that omits an approved supplier code', () => {
  const changed = structuredClone(generated);
  visitPermissionEnums(changed, (values) => {
    const index = values.indexOf('suppliers.matches.decide');
    if (index !== -1) values.splice(index, 1);
  });
  assert.equal(
    compareOpenApi(contract, changed, {
      allowedPermissionCodeAdditions: supplierPermissionCodes,
    }).equal,
    false,
  );
});

test('checker rejects a route without its server-side permission', () => {
  const changed = structuredClone(generated);
  delete changed.paths['/v1/staff/users'].get['x-permission'];
  assert.equal(compareOpenApi(contract, changed).equal, false);
});

test('checker rejects a changed CSRF policy', () => {
  const changed = structuredClone(generated);
  changed.paths['/v1/staff/users'].post['x-csrf'] = 'NONE';
  assert.equal(compareOpenApi(contract, changed).equal, false);
});

test('checker rejects root-level security invariant drift', () => {
  const changed = structuredClone(generated);
  changed['x-admin-preservation'].fullAdminProtectedPermissions = [];
  assert.equal(compareOpenApi(contract, changed).equal, false);
});
