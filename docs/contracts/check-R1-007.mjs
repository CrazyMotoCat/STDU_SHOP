import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baseline = '1e3c24cdd04628180f600f28aab0f88c37f23eb8';
const approvedSourceHead = '241b9c1a6d6e57b7ff1999e1aae46b66c33cb131';
const approvedSourceSha256 = {
  'docs/contracts/R1-007-supplier-audit-registry.json':
    '6b1ea4548ca140d07365b0a96e773814a03c6126e26cbf0f39646b710d985ae3',
  'docs/contracts/R1-007-supplier-data-model.json':
    'bdf6996267deaf4609c5512d09ed89b0215fdfd2b95d3a7cb6c9c124186421e6',
  'docs/contracts/R1-007-supplier-data-model.md':
    '619ec96c513574ffd79d2ca390db3843b8b509a68190ac8ca72140ade6413713',
  'docs/contracts/R1-007-supplier-domain-contract.md':
    '5b6cf4566607cdf06dfe665caf2bdce9f7b14982877711e03d7314f1968be6df',
  'docs/contracts/R1-007-supplier-rbac-matrix.json':
    '2a06950c4f96cf6386da45d6ecc0f2e5f082f840ccd543f9f781ad6c4d500fbc',
  'docs/contracts/R1-007-supplier-rbac-matrix.md':
    '1f699dc896621e44f902dcc4b5adb01167ea4cff23ee245f00e4feb218938ca0',
  'docs/contracts/R1-007-supplier-staff-ui.md':
    '908ce8ab84f9528df79c4a85a17864db4a2f9f2fbf29664dad0afdf9e8fcd3ac',
  'docs/contracts/R1-007-supplier-state-machine.md':
    '6ad94dd0e2ca7f19ffbd50b64f70e39c1ff8767a221f669f9e32be3e282cfa32',
  'docs/contracts/R1-007-suppliers.openapi.json':
    '1dbc1d0a9b03ba2ed20d00f86f0a58ad5b23ccbdb79134d35c55e5d427582dae',
  'docs/contracts/R1-007-test-matrix.md':
    '24ad53f1167615a7fb7be3bf5c6c80c1e8603f325f4d17e4878173882e5ccace',
  'docs/contracts/check-R1-007.mjs':
    '4771d725507b0fb2c5b3d28f09598c987c20b7149bb9bcdf8d9d723f7f26834a',
  'docs/contracts/check-R1-007.test.mjs':
    'f7b04f48460b6f5500140d8f358a79c6a3cab360c40639ee219cb9d83b928b63',
  'docs/plans/R1-007A-owner-decisions.md':
    'ac82a810b76c4850b025c8f1daa72200793cea6123006db2802eaf7af3d6f12c',
  'docs/plans/R1-007B-implementation-plan.md':
    'ae913d06d31e5a3ed30600dd615eea54bf542a73503aabfd5832a554c29bd912',
};
const frozenArtifactPaths = [
  'docs/contracts/R1-007-supplier-audit-registry.json',
  'docs/contracts/R1-007-supplier-data-model.json',
  'docs/contracts/R1-007-supplier-data-model.md',
  'docs/contracts/R1-007-supplier-domain-contract.md',
  'docs/contracts/R1-007-supplier-rbac-matrix.json',
  'docs/contracts/R1-007-supplier-rbac-matrix.md',
  'docs/contracts/R1-007-supplier-staff-ui.md',
  'docs/contracts/R1-007-supplier-state-machine.md',
  'docs/contracts/R1-007-suppliers.openapi.json',
  'docs/contracts/R1-007-test-matrix.md',
  'docs/plans/R1-007A-owner-decisions.md',
  'docs/plans/R1-007B-implementation-plan.md',
];
const frozenArtifactSha256 = {
  'docs/contracts/R1-007-supplier-audit-registry.json':
    '56a6f3407b91193f5efa799e116fa49b84eb8e4b8a1663f21df73a29fe1e4d54',
  'docs/contracts/R1-007-supplier-data-model.json':
    '4e1ea6099fbf49b0ed5d0dfc89ae932eff568a92574a457962cac1ad1b3351f8',
  'docs/contracts/R1-007-supplier-data-model.md':
    '79871718321011723b985c3ab9d1c223924daa42d251b03e9d1335282ca72383',
  'docs/contracts/R1-007-supplier-domain-contract.md':
    'f6da918b10cc14ed6eabe16f9ff1c03dcc9fe5870005bc5b3796a9fcf9fc82db',
  'docs/contracts/R1-007-supplier-rbac-matrix.json':
    '1fd4a7e895404cec32ad2d73f2ec775f081aa80fe045a9c3f39b74f1f1895062',
  'docs/contracts/R1-007-supplier-rbac-matrix.md':
    '59de5822482dd75bc8ad51a89edd99e7b52caa308f249a7fe0abceef8be21a1d',
  'docs/contracts/R1-007-supplier-staff-ui.md':
    '2ad718445c72a9197017d3f4e98d500541572bd7803ba3915fedb965914d6ea2',
  'docs/contracts/R1-007-supplier-state-machine.md':
    '7a0f0b06b889587c3b944044f69959dbbe578769255651bd86c230f113bddb99',
  'docs/contracts/R1-007-suppliers.openapi.json':
    'e24519d5eb33f3710922e16fd5e079cf986fc202bd5c4ce3e6e2a56fd0008bcd',
  'docs/contracts/R1-007-test-matrix.md':
    '68a325f48fb9fabd150fccf4a9e275ce3e640304ee55d92abc746e4a30edd03d',
  'docs/plans/R1-007A-owner-decisions.md':
    'af4147ea0a07d93af3ea9a997602223f184a35f363d1474f190e5e1d60d552f7',
  'docs/plans/R1-007B-implementation-plan.md':
    '4fa4b20d747ab6536de3e6060089d048f3dfdec0d283a358743ec4f858b36df6',
};
const supplierPermissionCodes = [
  'suppliers.read',
  'suppliers.write',
  'suppliers.offers.read',
  'suppliers.offers.write',
  'suppliers.matches.decide',
];
const frozenPermissionCodes = new Set([
  'audit.read',
  'catalog.products.read',
  'catalog.references.read',
]);
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

export async function loadSupplierContract() {
  const [
    model,
    rbac,
    openapi,
    audit,
    matrix,
    decisions,
    stateMachine,
    modelMarkdown,
    ui,
    domainContract,
    rbacMarkdown,
    implementationPlan,
    frozenManifest,
  ] = await Promise.all([
    json('docs/contracts/R1-007-supplier-data-model.json'),
    json('docs/contracts/R1-007-supplier-rbac-matrix.json'),
    json('docs/contracts/R1-007-suppliers.openapi.json'),
    json('docs/contracts/R1-007-supplier-audit-registry.json'),
    readFile(resolve(root, 'docs/contracts/R1-007-test-matrix.md'), 'utf8'),
    readFile(resolve(root, 'docs/plans/R1-007A-owner-decisions.md'), 'utf8'),
    readFile(
      resolve(root, 'docs/contracts/R1-007-supplier-state-machine.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/contracts/R1-007-supplier-data-model.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/contracts/R1-007-supplier-staff-ui.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/contracts/R1-007-supplier-domain-contract.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/contracts/R1-007-supplier-rbac-matrix.md'),
      'utf8',
    ),
    readFile(
      resolve(root, 'docs/plans/R1-007B-implementation-plan.md'),
      'utf8',
    ),
    json('docs/contracts/R1-007-frozen-manifest.json'),
  ]);
  const frozenArtifactHashes = Object.fromEntries(
    await Promise.all(
      frozenArtifactPaths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(resolve(root, path)))
          .digest('hex'),
      ]),
    ),
  );
  return {
    model,
    rbac,
    openapi,
    audit,
    matrix,
    decisions,
    stateMachine,
    modelMarkdown,
    ui,
    domainContract,
    rbacMarkdown,
    implementationPlan,
    frozenManifest,
    frozenArtifactHashes,
  };
}

function operationList(openapi) {
  return Object.entries(openapi.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => methods.has(method))
      .map(([method, operation]) => ({ path, method, operation })),
  );
}

export function validateSupplierContract(contract) {
  const {
    model,
    rbac,
    openapi,
    audit,
    matrix,
    decisions,
    stateMachine,
    modelMarkdown,
    ui,
    domainContract,
    rbacMarkdown,
    implementationPlan,
    frozenManifest,
    frozenArtifactHashes,
  } = contract;
  assert.equal(model.status, 'FROZEN');
  assert.equal(rbac.status, 'FROZEN');
  assert.equal(audit.status, 'FROZEN');
  assert.equal(model.version, '1.0.0');
  assert.equal(rbac.version, model.version);
  assert.equal(audit.version, model.version);
  assert.equal(openapi.info.version, model.version);
  assert.equal(model.baseline, baseline);
  assert.equal(openapi['x-baseline'], baseline);
  assert.equal(openapi['x-contract-status'], 'FROZEN 1.0.0');
  assert.equal(openapi['x-contract-version'], model.version);
  assert.equal(frozenManifest.status, 'FROZEN');
  assert.equal(frozenManifest.version, model.version);
  assert.equal(frozenManifest.approval.sourceHead, approvedSourceHead);
  assert.deepEqual(frozenManifest.approvedSourceSha256, approvedSourceSha256);
  assert.match(
    frozenManifest.approval.statement,
    /Утверждаю пакет R1-007A Supplier Domain Contract версии 0\.1\.0-proposed на SHA `241b9c1a6d6e57b7ff1999e1aae46b66c33cb131`/,
  );
  assert.deepEqual(frozenManifest.approval.decisionIds, [
    'OD-007A-01',
    'OD-007A-02',
    'OD-007A-03',
    'OD-007A-04',
    'OD-007A-05',
    'OD-007A-06',
    'OD-007A-07',
  ]);
  assert.deepEqual(
    Object.keys(frozenManifest.frozenArtifactSha256).sort(),
    [...frozenArtifactPaths].sort(),
  );
  assert.deepEqual(
    frozenManifest.frozenArtifactSha256,
    frozenArtifactSha256,
    'frozen artifact checksum manifest must match the reviewed finalization',
  );
  for (const path of frozenArtifactPaths) {
    assert.equal(
      frozenManifest.frozenArtifactSha256[path],
      frozenArtifactHashes[path],
      `frozen SHA-256 mismatch for ${path}`,
    );
  }
  assert.match(domainContract, /\*\*Status:\*\* FROZEN/);
  assert.match(domainContract, /Contract version:\*\* `1\.0\.0`/);
  assert.match(rbacMarkdown, /^# R1-007 Supplier Permissions — FROZEN 1\.0\.0/);
  assert.match(modelMarkdown, /^# R1-007 Supplier Data Model — FROZEN 1\.0\.0/);
  assert.match(
    stateMachine,
    /^# R1-007 Supplier State Machine — FROZEN 1\.0\.0/,
  );
  assert.match(matrix, /^# R1-007 Contract Acceptance Matrix — FROZEN 1\.0\.0/);
  assert.match(ui, /^# R1-007 Supplier Staff UI — FROZEN 1\.0\.0/);
  assert.match(implementationPlan, /FROZEN R1-007A 1\.0\.0/);
  assert.deepEqual(model.extends, [
    'FROZEN R1-002 1.0.0',
    'FROZEN R1-004 1.0.0',
    'FROZEN R1-006A 1.0.0',
  ]);

  assert.deepEqual(Object.keys(model.tables).sort(), [
    'ProductMatchProposal',
    'Supplier',
    'SupplierCommandIdempotency',
    'SupplierOffer',
    'SupplierOfferRevision',
    'SupplierRevision',
  ]);
  assert.equal(Object.keys(model.tables).length, 6);
  assert.deepEqual(
    Object.keys(rbac.permissions).sort(),
    [...supplierPermissionCodes].sort(),
  );
  assert.equal(rbac.defaultDeny, true);
  assert.equal(rbac.automaticRoleGrants, false);
  assert.equal(rbac.changesFrozenProtectedAdminSet, false);
  assert.deepEqual(
    [...openapi['x-permission-catalog-extension'].codes].sort(),
    [...supplierPermissionCodes].sort(),
  );

  const identity = model.rules.identity;
  assert.deepEqual(identity.fields, [
    'brandId',
    'manufacturerName',
    'originalPartNumber',
    'modification',
  ]);
  assert.match(identity.normalization, /NFC.*outer U\+0020.*preserve case/i);
  assert.match(identity.unknownModification, /never matches NULL/i);
  assert.match(
    identity.automaticMatch,
    /Exact candidate only.*no name similarity.*auto-association/i,
  );
  assert.match(modelMarkdown, /never a `SellerLegalEntity`/);
  assert.match(modelMarkdown, /public catalog\/quotation DTOs/i);
  assert.match(modelMarkdown, /SupplierOffer.currentMatchProposalId/);
  assert.match(model.rules.supplierTaxIdentity.pair, /both NULL|both.*null/i);
  assert.match(
    model.rules.supplierTaxIdentity.RU,
    /10 or 12.*leading zeroes.*checksum/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.RU,
    /first-check weights \[7,2,4,10,3,5,9,4,6,8\].*second-check weights \[3,7,2,4,10,3,5,9,4,6,8\]/,
  );
  assert.match(
    model.rules.supplierTaxIdentity.foreign,
    /NFC.*outer ASCII U\+0020.*do not apply RU/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.activeUniqueness,
    /partial unique.*ACTIVE/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.archivedReRegistration,
    /new ACTIVE.*new ID.*never/i,
  );
  assert.ok(
    model.tables.Supplier.uniqueIndexes.some(
      (index) =>
        index.where.includes("state='ACTIVE'") &&
        index.columns.join(',') === 'taxJurisdiction,taxIdentifier',
    ),
    'supplier tax identity must be unique only among ACTIVE rows',
  );
  assert.equal(
    openapi.components.parameters.IdempotencyKey.schema.minLength,
    8,
  );
  assert.equal(
    openapi.components.parameters.IdempotencyKey.schema.maxLength,
    128,
  );
  assert.match(
    model.tables.SupplierOfferRevision.fields.manufacturerName,
    /varchar\(200\)/,
  );
  assert.match(
    model.tables.ProductMatchProposal.deletePolicy,
    /new proposal ID after rejection or unlink/i,
  );
  assert.ok(
    model.tables.ProductMatchProposal.uniqueIndexes.some(
      (index) =>
        index.where.includes("state='PENDING'") &&
        index.columns.join(',') === 'offerId,offerRevisionId,proposedProductId',
    ),
    'only active PENDING proposal tuples must be unique',
  );
  assert.deepEqual(model.tables.SupplierCommandIdempotency.unique, [
    ['actorStaffUserId', 'scope', 'idempotencyKey'],
  ]);
  assert.match(
    model.rules.idempotency.scope,
    /exact opaque Idempotency-Key.*8-128/i,
  );
  assert.match(
    model.tables.SupplierCommandIdempotency.fields.idempotencyKey,
    /COLLATE "C"/,
  );
  assert.match(
    model.tables.SupplierCommandIdempotency.retention,
    /indefinitely/i,
  );
  assert.match(
    model.rules.idempotency.canonicalRequestHash,
    /SHA-256.*RFC 8785/i,
  );
  assert.match(
    model.rules.idempotency.versionConflict,
    /exact retry returns same 409.*new key/i,
  );
  assert.match(stateMachine, /PENDING/);
  assert.match(stateMachine, /APPROVED/);
  assert.match(stateMachine, /REJECTED/);
  assert.match(stateMachine, /no bulk command/i);

  const offer = model.tables.SupplierOffer;
  assert.ok(
    model.tables.Supplier.fields.currentRevisionId.includes('SupplierRevision'),
  );
  assert.match(model.tables.SupplierRevision.immutability, /Append-only/i);
  assert.ok(
    [
      'legalName',
      'shortName',
      'taxIdentifier',
      'taxJurisdiction',
      'contactName',
      'email',
      'phone',
      'website',
      'internalNotes',
    ].every((field) =>
      openapi.components.schemas.SupplierRevision.required.includes(field),
    ),
    'profile history API must return complete snapshots including explicit null fields',
  );
  assert.ok(openapi.paths['/v1/staff/suppliers/{supplierId}/revisions']?.get);
  assert.equal(
    openapi.paths['/v1/staff/suppliers/{supplierId}/revisions'].get[
      'x-permission'
    ],
    'suppliers.read',
  );
  assert.ok(
    openapi.components.schemas.SupplierMutationReceipt.properties.data
      .properties.revisionId,
    'profile mutation receipt exposes revisionId without returning private fields',
  );
  assert.ok(offer.fields.currentMatchProposalId.includes('NULL'));
  assert.ok(offer.fields.currentRevisionId.includes('NOT NULL'));
  assert.ok(
    model.tables.SupplierOfferRevision.fields.purchaseCost.startsWith(
      'numeric',
    ),
  );
  assert.match(
    model.tables.SupplierOfferRevision.fields.currency,
    /varchar\(3\)/,
  );
  assert.match(model.tables.SupplierOfferRevision.fields.origin, /MANUAL/);
  assert.match(
    model.tables.ProductMatchProposal.fields.state,
    /PENDING\|APPROVED\|REJECTED/,
  );
  assert.match(model.rules.concurrency, /same transaction/i);
  assert.match(model.rules.audit, /PostgreSQL transaction/i);

  for (const permission of Object.keys(rbac.permissions)) {
    assert.match(permission, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
  }
  for (const [action, required] of Object.entries(rbac.actionRequirements)) {
    assert.ok(required.length > 0, `${action} must require a permission`);
    for (const permission of required) {
      assert.ok(
        Object.hasOwn(rbac.permissions, permission) ||
          frozenPermissionCodes.has(permission),
        `${action} uses an undeclared permission ${permission}`,
      );
    }
  }

  const operations = operationList(openapi);
  assert.equal(
    operations.length,
    20,
    'R1-007 staff API operation count is part of this proposal',
  );
  const operationIds = operations.map(({ operation }) => operation.operationId);
  assert.equal(
    new Set(operationIds).size,
    operationIds.length,
    'operationId values must be unique',
  );
  assert.ok(operations.every(({ path }) => path.startsWith('/v1/staff/')));
  assert.ok(operations.every(({ path }) => !path.includes('/public/')));
  assert.equal(
    operations.some(({ path }) => /bulk|batch/i.test(path)),
    false,
  );

  for (const { path, method, operation } of operations) {
    const declaredPermissions = [
      operation['x-permission'],
      ...(operation['x-additional-permissions'] ?? []),
    ];
    assert.ok(
      operation.operationId,
      `${method.toUpperCase()} ${path} needs operationId`,
    );
    assert.ok(
      operation['x-permission'],
      `${method.toUpperCase()} ${path} needs server permission`,
    );
    for (const permission of declaredPermissions) {
      assert.ok(
        Object.hasOwn(rbac.permissions, permission) ||
          frozenPermissionCodes.has(permission),
        `${method.toUpperCase()} ${path} uses undeclared permission ${permission}`,
      );
    }
    const parameters = operation.parameters ?? [];
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      const refs = parameters.map((parameter) => parameter['$ref']);
      assert.ok(
        refs.includes('#/components/parameters/OriginHeader'),
        `${path} mutation needs Origin`,
      );
      assert.ok(
        refs.includes('#/components/parameters/CsrfToken'),
        `${path} mutation needs CSRF`,
      );
      assert.ok(
        refs.includes('#/components/parameters/IdempotencyKey'),
        `${path} mutation needs durable idempotency`,
      );
      assert.equal(operation['x-csrf'], 'STAFF_BOUND');
      assert.ok(
        operation['x-audit'],
        `${path} mutation must identify audit behavior`,
      );
    }
  }

  const paths = Object.keys(openapi.paths);
  assert.ok(
    paths.includes('/v1/staff/supplier-match-proposals/{proposalId}/decision'),
  );
  assert.ok(
    paths.includes('/v1/staff/supplier-offers/{offerId}/match-candidates'),
  );
  const decision =
    openapi.paths['/v1/staff/supplier-match-proposals/{proposalId}/decision']
      .post;
  assert.ok(
    decision.parameters.some(
      (parameter) =>
        parameter['$ref'] === '#/components/parameters/IdempotencyKey',
    ),
    'proposal decision must be idempotent',
  );
  assert.deepEqual(openapi.components.schemas.ProposalState.enum, [
    'PENDING',
    'APPROVED',
    'REJECTED',
  ]);
  assert.equal(openapi.components.schemas.PurchaseCost.type, 'string');
  assert.equal(openapi.components.schemas.PurchaseCost.format, undefined);
  assert.match(openapi.components.schemas.PurchaseCost.pattern, /\\\./);
  assert.equal(
    openapi.components.schemas.SupplierOffer.properties.currentMatchProposalId
      .type[1],
    'null',
  );
  for (const schemaName of [
    'Supplier',
    'CreateSupplier',
    'UpdateSupplier',
    'SupplierRevision',
  ]) {
    const schema = openapi.components.schemas[schemaName];
    if (schemaName === 'Supplier') {
      assert.ok(schema.required.includes('taxIdentifier'));
      assert.ok(schema.required.includes('taxJurisdiction'));
    }
    assert.ok(
      schema.allOf.some(
        (condition) =>
          condition['$ref'] === '#/components/schemas/TaxIdentityConstraint',
      ),
      `${schemaName} must conditionally validate Russian tax identifier format`,
    );
  }
  const taxIdentityConstraint =
    openapi.components.schemas.TaxIdentityConstraint;
  assert.deepEqual(taxIdentityConstraint.dependentRequired.taxIdentifier, [
    'taxJurisdiction',
  ]);
  assert.deepEqual(taxIdentityConstraint.dependentRequired.taxJurisdiction, [
    'taxIdentifier',
  ]);
  assert.equal(
    taxIdentityConstraint.then.properties.taxIdentifier.pattern,
    '^(?:[0-9]{10}|[0-9]{12})$',
  );
  assert.equal(
    openapi.components.schemas.IdentityFields.properties.manufacturerName
      .maxLength,
    200,
  );
  assert.equal(
    openapi.components.schemas.MatchCandidate.properties.manufacturerName
      .maxLength,
    200,
  );
  assert.match(
    openapi['x-idempotency-contract'].transaction,
    /commit together/i,
  );
  assert.match(
    openapi['x-tax-identity-validation'].RU,
    /weighted sum mod 11.*mod 10/i,
  );
  assert.match(
    openapi['x-idempotency-contract'].concurrent,
    /waits and replays/i,
  );
  assert.match(
    openapi.components.responses.Conflict.description,
    /no partial domain mutation.*409.*idempotency response.*without a success AuditEvent/i,
  );
  assert.match(openapi['x-idempotency-contract'].retention, /indefinitely/i);
  assert.match(
    openapi['x-idempotency-contract'].keyScope,
    /actorStaffUserId.*R1-007.*8-128/i,
  );

  for (const event of [
    'supplier.created',
    'supplier.changed',
    'supplier.archived',
    'supplier_offer.created',
    'supplier_offer.revised',
    'supplier_offer.archived',
    'supplier_match.proposed',
    'supplier_match.approved',
    'supplier_match.rejected',
    'supplier_match.unlinked',
  ]) {
    assert.ok(audit.events[event], `missing audit event ${event}`);
  }
  assert.match(audit.changesValuePolicy, /purchase amount\/currency/);
  assert.match(matrix, /SUP-01[\s\S]*SUP-17/);
  for (const id of [
    'SUP-19',
    'SUP-20',
    'SUP-21',
    'SUP-22',
    'SUP-23',
    'SUP-24',
    'SUP-25',
    'SUP-26',
    'SUP-27',
    'SUP-28',
  ]) {
    assert.ok(matrix.includes(id), `missing regression scenario ${id}`);
  }
  assert.match(matrix, /E2E-05/);
  for (const id of [
    'OD-007A-01',
    'OD-007A-02',
    'OD-007A-03',
    'OD-007A-04',
    'OD-007A-05',
    'OD-007A-06',
    'OD-007A-07',
  ]) {
    assert.ok(decisions.includes(id), `missing owner decision ${id}`);
  }
  assert.match(
    decisions,
    /R1-002\/R1-004\/R1-006A files and existing grants unchanged/i,
  );
  for (const route of [
    '/staff/suppliers',
    '/staff/suppliers/[supplierId]',
    '/staff/suppliers/offers',
    '/staff/suppliers/matches',
  ]) {
    assert.ok(
      ui.includes(route),
      `missing protected supplier UI route ${route}`,
    );
  }
  assert.match(ui, /No select-all, batch action/i);
  assert.match(
    openapi.paths['/v1/staff/supplier-offers'].get['x-invariants'].join(' '),
    /currency groups sort by ISO code.*sortDirection changes exact numeric order only within each group.*null cost last.*offerId ascending/i,
  );

  return {
    operationCount: operations.length,
    permissionCount: supplierPermissionCodes.length,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const contract = await loadSupplierContract();
  await SwaggerParser.validate(structuredClone(contract.openapi));
  const result = validateSupplierContract(contract);
  console.log(
    `R1-007A FROZEN 1.0.0 contract valid: ${result.operationCount} staff operations, ${result.permissionCount} supplier permissions, ${Object.keys(contract.model.tables).length} tables.`,
  );
}
