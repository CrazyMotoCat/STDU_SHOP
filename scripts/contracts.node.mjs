import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOpenApi, readJson } from './openapi-contract.mjs';

const contract = await readJson('docs/contracts/R1-002-staff.openapi.json');
const generated = await readJson(
  '.local/contracts/generated-staff.openapi.json',
);

test('T-20: generated Nest OpenAPI equals the frozen contract', () => {
  assert.deepEqual(compareOpenApi(contract, generated), {
    equal: true,
    differences: [],
  });
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
