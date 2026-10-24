import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const baseline = '1e3c24cdd04628180f600f28aab0f88c37f23eb8';
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
  ]);
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
  } = contract;
  assert.equal(model.status, 'PROPOSED');
  assert.equal(rbac.status, 'PROPOSED');
  assert.equal(audit.status, 'PROPOSED');
  assert.equal(model.version, '0.1.0-proposed');
  assert.equal(rbac.version, model.version);
  assert.equal(audit.version, model.version);
  assert.equal(model.baseline, baseline);
  assert.equal(openapi['x-baseline'], baseline);
  assert.equal(openapi['x-contract-status'], 'PROPOSED / REVIEW_REQUIRED');
  assert.equal(openapi['x-contract-version'], model.version);
  assert.deepEqual(model.extends, [
    'FROZEN R1-002 1.0.0',
    'FROZEN R1-004 1.0.0',
    'FROZEN R1-006A 1.0.0',
  ]);

  assert.deepEqual(Object.keys(model.tables).sort(), [
    'ProductMatchProposal',
    'Supplier',
    'SupplierOffer',
    'SupplierOfferRevision',
    'SupplierRevision',
  ]);
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
  assert.match(matrix, /E2E-05/);
  for (const id of [
    'OD-007A-01',
    'OD-007A-02',
    'OD-007A-03',
    'OD-007A-04',
    'OD-007A-05',
    'OD-007A-06',
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
    /price sort orders currency groups first and price only within each currency/i,
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
    `R1-007A contract valid: ${result.operationCount} staff operations, ${result.permissionCount} proposed permissions, ${Object.keys(contract.model.tables).length} tables.`,
  );
}
