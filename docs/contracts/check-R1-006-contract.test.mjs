import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const ownerDecisions = await readFile(
  resolve(root, 'docs/plans/R1-006A-owner-decisions.md'),
  'utf8',
);
const frozenManifest = JSON.parse(
  await readFile(
    resolve(root, 'docs/contracts/R1-006-frozen-manifest.json'),
    'utf8',
  ),
);

test('R1-006A is frozen at the owner-approved proposal with verified checksums', async () => {
  const approvedSha = 'dab9e7902b3798c21376ce8bb91c965a67c80b2a';
  assert.equal(audit.status, 'FROZEN');
  assert.equal(audit.version, '1.0.0');
  assert.equal(dataModel.status, 'FROZEN');
  assert.equal(dataModel.version, '1.0.0');
  assert.equal(openapi['x-contract-status'], 'FROZEN');
  assert.equal(openapi.info.version, '1.0.0');
  assert.match(ownerDecisions, new RegExp(approvedSha));
  assert.equal(frozenManifest.status, 'FROZEN');
  assert.equal(frozenManifest.version, '1.0.0');
  assert.equal(frozenManifest.ownerApproval.approvedHeadSha, approvedSha);
  assert.equal(frozenManifest.ownerApproval.proposalVersion, '0.1.0-proposed');
  assert.equal(
    frozenManifest.integration.mainSyncSha,
    '581cef81f7db7eb6141bdeeee6a997ab6c185339',
  );
  assert.equal(
    frozenManifest.integration.approvedArtifactsVerifiedBeforeFreeze,
    true,
  );
  const approvedArtifactSha256 = {
    'docs/contracts/R1-006-catalog-import-audit-registry.json':
      'aa7c4c4ab7cf56fa11e8620917918885a597869fd9cbdb89e67019694d9e9248',
    'docs/contracts/R1-006-catalog-import-contract.md':
      '89eb10f5f5174ba6adba2e53e53dbf2d426be146d745332de7e91065e77bddc6',
    'docs/contracts/R1-006-catalog-import-data-model.json':
      'b47b75f707af7403b7d1b71edd6feb32b670993685eda2958363697879f1912e',
    'docs/contracts/R1-006-catalog-import.openapi.json':
      '36d126d54be4baa4366c7bc44dc087a5797ca4cb671e3c75ad5599fd026521a1',
    'docs/contracts/R1-006-test-matrix.md':
      '6a85ca0082d8b87ead9f445067763040cd33f2517f0d1db88b6f62db1e8f1beb',
    'docs/contracts/check-R1-006-contract.test.mjs':
      '752efe85ea8d03609094f8551fc2200b4f0f456e14c894dc28470fe6750f0fc1',
    'docs/plans/R1-006A-owner-decisions.md':
      '9f9151b31bd67a660ed0410c7d3ed65e57adc3c75f5ca3a6e7896f1c927594b5',
  };
  assert.deepEqual(
    frozenManifest.integration.approvedArtifactSha256,
    approvedArtifactSha256,
  );
  assert.deepEqual(frozenManifest.ownerApproval.decisions, [
    'OD-006A-01',
    'OD-006A-02',
    'OD-006A-03',
    'OD-006A-04',
    'OD-006A-05',
  ]);

  assert.deepEqual(
    Object.keys(frozenManifest.frozenArtifactSha256).sort(),
    Object.keys(approvedArtifactSha256).sort(),
  );
  for (const [path, expectedHash] of Object.entries(
    frozenManifest.frozenArtifactSha256,
  )) {
    const bytes = await readFile(resolve(root, path));
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(actualHash, expectedHash, `checksum mismatch for ${path}`);
  }
});

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

test('internal parser framing and retention gates are present in the frozen contract', async () => {
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
