import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const openapi = JSON.parse(
  await readFile(
    resolve(root, 'docs/contracts/R1-006-catalog-import.openapi.json'),
    'utf8',
  ),
);
const audit = JSON.parse(
  await readFile(
    resolve(root, 'docs/contracts/R1-006-catalog-import-audit-registry.json'),
    'utf8',
  ),
);
const dataModel = JSON.parse(
  await readFile(
    resolve(root, 'docs/contracts/R1-006-catalog-import-data-model.json'),
    'utf8',
  ),
);

function operation(operationId) {
  for (const path of Object.values(openapi.paths)) {
    for (const candidate of Object.values(path)) {
      if (candidate.operationId === operationId) return candidate;
    }
  }
  assert.fail(`Missing operation ${operationId}`);
}

test('CSV options are upload-only and absent from mapping JSON Schema', () => {
  const mapping = openapi.components.schemas.ImportMappingRequest;
  assert.equal(Object.hasOwn(mapping.properties, 'csvOptions'), false);
  assert.equal(
    Object.hasOwn(mapping.properties.sheetMappings, 'csvOptions'),
    false,
  );
  assert.doesNotMatch(JSON.stringify(mapping), /csvOptions/);

  const upload =
    openapi.paths['/v1/staff/catalog/imports'].post.requestBody.content[
      'multipart/form-data'
    ].schema;
  assert.deepEqual(
    Object.keys(upload.properties).filter((key) => key.startsWith('csv')),
    ['csvEncoding', 'csvDelimiter'],
  );
});

test('corrections preserve the existing staff route and entity counts', () => {
  const operationCount = Object.values(openapi.paths).reduce(
    (count, path) => count + Object.keys(path).length,
    0,
  );
  assert.equal(operationCount, 8);
  assert.deepEqual(Object.keys(dataModel.entities).sort(), [
    'CatalogImportDecision',
    'CatalogImportRow',
    'CatalogImportRun',
  ]);
});

test('sheet mapping supports fixed ACTIVE references without column ambiguity', () => {
  const sheet =
    openapi.components.schemas.ImportMappingRequest.properties.sheetMappings
      .items;
  assert.equal(sheet.properties.fixedCategoryId.format, 'uuid');
  assert.equal(sheet.properties.fixedBrandId.format, 'uuid');
  assert.match(sheet.description, /ACTIVE/);
  assert.match(sheet.description, /400 VALIDATION_ERROR/);
  assert.match(
    sheet.description,
    /Different sheets may use different fixed references/,
  );
  assert.match(sheet.description, /exact categoryId and attributeDefinitionId/);
  assert.match(
    sheet.description,
    /With fixedCategoryId, attribute mappings must use that exact categoryId/,
  );
});

test('cross-owner visibility is explicit and requires references permission for mapping and decision', () => {
  for (const id of [
    'listCatalogImports',
    'getCatalogImport',
    'listCatalogImportRows',
    'getCatalogImportRowHistory',
    'setCatalogImportMapping',
    'previewOrResumeCatalogImport',
    'decideCatalogImportRow',
  ]) {
    const op = operation(id);
    assert.ok(op['x-owner-scope']);
    assert.ok(op['x-cross-owner-audit']);
    const adminScope = [
      'setCatalogImportMapping',
      'previewOrResumeCatalogImport',
      'decideCatalogImportRow',
    ].includes(id)
      ? 'crossOwnerMutation'
      : 'crossOwnerRead';
    assert.match(
      op['x-owner-scope'],
      new RegExp(`x-import-authorization\\.${adminScope}`),
    );
  }
  assert.match(
    JSON.stringify(openapi['x-import-authorization'].crossOwnerRead),
    /controlAdminRequiredPermissions/,
  );
  assert.match(
    JSON.stringify(openapi['x-import-authorization'].crossOwnerMutation),
    /catalog.references.read/,
  );
  assert.match(
    openapi['x-import-authorization'].crossOwnerRead.evaluation,
    /effective union/,
  );
  assert.equal(
    openapi['x-import-authorization'].crossOwnerRead.status,
    'ACTIVE',
  );
  assert.equal(
    openapi['x-import-authorization'].crossOwnerRead.roleNameAloneGrantsAccess,
    false,
  );
  assert.equal(
    openapi['x-import-authorization'].defaultListScope,
    'authenticated caller only',
  );
  assert.deepEqual(openapi['x-import-authorization'].ownerRead, [
    'catalog.products.read',
  ]);
  assert.ok(
    operation('listCatalogImports').parameters.some(
      (parameter) =>
        parameter.$ref === '#/components/parameters/OwnerStaffUserId',
    ),
  );
  for (const id of [
    'setCatalogImportMapping',
    'previewOrResumeCatalogImport',
    'decideCatalogImportRow',
  ]) {
    assert.ok(
      operation(id)['x-additional-permissions'].includes(
        'catalog.references.read',
      ),
    );
  }
  assert.ok(audit.actions['catalog.import.cross_owner.accessed']);
});

test('ACCEPT conflict aligns HTTP, row, decision, audit, rollback and retry semantics', () => {
  const op = operation('decideCatalogImportRow');
  assert.deepEqual(op['x-conflict-semantics'], {
    httpStatus: 409,
    codes: ['IMPORT_ROW_CONFLICT', 'IDENTITY_CONFLICT'],
    candidateState: 'CONFLICT',
    decisionOutcome: 'CONFLICT',
    decisionConflictCode:
      'the same exact 409 code is persisted for idempotent replay',
    auditOutcome: 'DENIED',
    successAudit: false,
    catalogMutation: 'rolled back before the conflict record transaction',
    conflictRecordTransaction:
      'Atomically persists row CONFLICT, one CatalogImportDecision outcome CONFLICT with conflictCode, and one catalog.import.row.decided denial AuditEvent linked by auditEventId.',
    sameKeySameHashReplay:
      'Return the stored 409 outcome and conflictCode without inserting another decision or audit event.',
    sameKeyDifferentHash:
      'Return 409 IDEMPOTENCY_KEY_REUSED without inserting another decision.',
  });
  assert.match(op.responses['409'].description, /candidateState=CONFLICT/);
  assert.match(op.responses['409'].description, /VERSION_CONFLICT/);
  const decision = openapi.components.schemas.ImportDecision;
  assert.ok(decision.required.includes('conflictCode'));
  assert.deepEqual(decision.properties.conflictCode.enum, [
    'IMPORT_ROW_CONFLICT',
    'IDENTITY_CONFLICT',
    null,
  ]);
  const modelDecision = dataModel.entities.CatalogImportDecision;
  assert.deepEqual(modelDecision.fields.conflictCode.enum, [
    'IMPORT_ROW_CONFLICT',
    'IDENTITY_CONFLICT',
    null,
  ]);
  assert.ok(
    modelDecision.checks.some((check) =>
      check.includes('outcome=CONFLICT iff conflictCode'),
    ),
  );
  assert.ok(
    audit.actions['catalog.import.row.decided'].outcomes.DENIED.includes(
      'IDENTITY_CONFLICT',
    ),
  );
});

test('internal parser framing and retention gates are present in the proposed contract', async () => {
  const contract = await readFile(
    resolve(root, 'docs/contracts/R1-006-catalog-import-contract.md'),
    'utf8',
  );
  assert.match(contract, /Ровно одна терминальная запись обязательна/);
  assert.match(contract, /HTTP transport chunk boundaries произвольны/);
  assert.match(
    contract,
    /не создаёт FileObject, FileVersion, ImportRun или ImportRows/,
  );
  assert.match(
    contract,
    /Без такой политики production эксплуатация импорта не начинается/,
  );
});
