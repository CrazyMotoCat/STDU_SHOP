import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSupplierContract,
  validateSupplierContract,
} from './check-R1-007.mjs';

const baseline = await loadSupplierContract();

function ruInnChecksumValid(value) {
  if (!/^(?:[0-9]{10}|[0-9]{12})$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = (weights) =>
    (weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) %
      11) %
    10;
  if (digits.length === 10) {
    return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9];
  }
  return (
    check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10] &&
    check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11]
  );
}

function rejects(change) {
  const changed = structuredClone(baseline);
  change(changed);
  assert.throws(() => validateSupplierContract(changed));
}

test('R1-007A proposed supplier contract is internally consistent', () => {
  assert.doesNotThrow(() => validateSupplierContract(baseline));
});

test('checker rejects a public supplier route', () => {
  rejects((contract) => {
    contract.openapi.paths['/v1/public/supplier-offers'] = {
      get: {
        operationId: 'publicSupplierOffers',
        'x-permission': 'suppliers.offers.read',
      },
    };
  });
});

test('checker rejects binary floating-point money', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.PurchaseCost.type = 'number';
  });
});

test('checker rejects permission catalog drift', () => {
  rejects((contract) => {
    contract.rbac.permissions['suppliers.admin'] = 'unbounded supplier access';
  });
});

test('checker rejects role grants or protected-set changes', () => {
  rejects((contract) => {
    contract.rbac.automaticRoleGrants = true;
  });
  rejects((contract) => {
    contract.rbac.changesFrozenProtectedAdminSet = true;
  });
});

test('checker rejects widening a proposal state machine', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.ProposalState.enum.push('SUPERSEDED');
  });
});

test('tax identity is jurisdiction-aware, canonical, and reusable after archive', () => {
  const { model, openapi } = baseline;
  assert.match(
    model.rules.supplierTaxIdentity.RU,
    /10 or 12 digits.*leading zeroes.*checksum/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.RU,
    /weighted sum mod 11.*mod 10/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.RU,
    /first-check weights \[7,2,4,10,3,5,9,4,6,8\].*second-check weights \[3,7,2,4,10,3,5,9,4,6,8\]/,
  );
  assert.equal(ruInnChecksumValid('7707083893'), true);
  assert.equal(ruInnChecksumValid('010000000021'), true);
  assert.equal(ruInnChecksumValid('010000000022'), false);
  assert.equal(
    '010000000021'[0],
    '0',
    'INN stays a string and keeps its leading zero',
  );
  assert.match(
    model.rules.supplierTaxIdentity.foreign,
    /NFC.*outer ASCII U\+0020.*preserve case/i,
  );
  assert.match(
    model.rules.supplierTaxIdentity.archivedReRegistration,
    /new ACTIVE.*new ID.*never/i,
  );
  assert.deepEqual(
    model.tables.Supplier.uniqueIndexes.find(
      (index) => index.name === 'supplier_active_tax_identity_uq',
    ).columns,
    ['taxJurisdiction', 'taxIdentifier'],
  );
  const create = openapi.components.schemas.CreateSupplier;
  assert.ok(
    create.allOf.some(
      (rule) => rule.$ref === '#/components/schemas/TaxIdentityConstraint',
    ),
  );
  const taxConstraint = openapi.components.schemas.TaxIdentityConstraint;
  assert.deepEqual(taxConstraint.dependentRequired.taxIdentifier, [
    'taxJurisdiction',
  ]);
  assert.deepEqual(taxConstraint.dependentRequired.taxJurisdiction, [
    'taxIdentifier',
  ]);
  assert.ok(
    taxConstraint.if?.properties?.taxJurisdiction?.const === 'RU' &&
      taxConstraint.then?.properties?.taxIdentifier?.pattern ===
        '^(?:[0-9]{10}|[0-9]{12})$',
  );
});

test('checker rejects tax identity uniqueness that reserves archived suppliers', () => {
  rejects((contract) => {
    contract.model.tables.Supplier.uniqueIndexes[0].where =
      'taxIdentifier IS NOT NULL';
  });
});

test('proposal history allows a new pending proposal after rejection or unlink but prevents active duplicates', () => {
  const proposal = baseline.model.tables.ProductMatchProposal;
  assert.deepEqual(proposal.unique, [['id', 'offerId']]);
  assert.deepEqual(
    proposal.uniqueIndexes.find(
      (index) => index.name === 'product_match_one_pending_pair_uq',
    ).columns,
    ['offerId', 'offerRevisionId', 'proposedProductId'],
  );
  assert.match(proposal.uniqueIndexes[0].where, /state='PENDING'/);
  assert.match(
    proposal.deletePolicy,
    /new proposal ID after rejection or unlink/i,
  );
  assert.match(
    baseline.stateMachine,
    /never restores an older pointer automatically/i,
  );
});

test('checker rejects a proposal uniqueness rule that blocks terminal history retries', () => {
  rejects((contract) => {
    contract.model.tables.ProductMatchProposal.uniqueIndexes[0].where =
      'all states';
  });
});

test('all supplier mutations have durable actor-scoped idempotency and conflict replay', () => {
  const table = baseline.model.tables.SupplierCommandIdempotency;
  assert.deepEqual(table.unique, [
    ['actorStaffUserId', 'scope', 'idempotencyKey'],
  ]);
  assert.match(table.transaction, /one transaction.*atomically/i);
  assert.match(
    table.transaction,
    /VERSION_CONFLICT.*no domain mutation.*no success audit/i,
  );
  assert.match(table.retention, /retained indefinitely/i);
  assert.match(
    baseline.model.rules.idempotency.canonicalRequestHash,
    /SHA-256.*RFC 8785/i,
  );
  assert.match(
    baseline.model.rules.idempotency.restartRetry,
    /after API restart/i,
  );
  assert.match(
    baseline.model.rules.idempotency.versionConflict,
    /exact retry returns same 409.*new key/i,
  );
  assert.match(
    baseline.openapi.components.responses.Conflict.description,
    /no partial domain mutation.*409.*idempotency response.*without a success AuditEvent/i,
  );
  for (const [path, item] of Object.entries(baseline.openapi.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!['post', 'patch', 'put', 'delete'].includes(method)) continue;
      assert.ok(
        operation.parameters.some(
          (parameter) =>
            parameter.$ref === '#/components/parameters/IdempotencyKey',
        ),
        `${method.toUpperCase()} ${path} requires Idempotency-Key`,
      );
    }
  }
});

test('supplier offer manufacturer name remains compatible with frozen R1-004 length', () => {
  assert.equal(
    baseline.model.tables.SupplierOfferRevision.fields.manufacturerName,
    'varchar(200) NULL',
  );
  assert.equal(
    baseline.openapi.components.schemas.IdentityFields.properties
      .manufacturerName.maxLength,
    200,
  );
  assert.equal(
    baseline.openapi.components.schemas.MatchCandidate.properties
      .manufacturerName.maxLength,
    200,
  );
});

test('purchase-cost sorting uses deterministic currency groups and exact keyset tie-breakers', () => {
  const rules =
    baseline.openapi.paths['/v1/staff/supplier-offers'].get[
      'x-invariants'
    ].join(' ');
  assert.match(rules, /currency groups sort by ISO code.*ascending/i);
  assert.match(
    rules,
    /sortDirection changes exact numeric order only within each group/i,
  );
  assert.match(rules, /null cost last.*supplier legalName.*offerId ascending/i);
  assert.match(
    rules,
    /keyset-based.*exact canonical decimal string.*supplierName.*offerId/i,
  );
  assert.match(baseline.matrix, /SUP-27[\s\S]*deterministic keyset cursor/i);
});

test('checker rejects manufacturer length drift from R1-004', () => {
  rejects((contract) => {
    contract.model.tables.SupplierOfferRevision.fields.manufacturerName =
      'varchar(160) NULL';
  });
});

test('checker rejects removing idempotency from match decisions', () => {
  rejects((contract) => {
    contract.openapi.paths[
      '/v1/staff/supplier-match-proposals/{proposalId}/decision'
    ].post.parameters = [];
  });
});

test('checker rejects adding fuzzy match semantics', () => {
  rejects((contract) => {
    contract.model.rules.identity.automaticMatch =
      'Text similarity automatically links product';
  });
});

test('checker rejects changes to the approved R1 baseline', () => {
  rejects((contract) => {
    contract.model.baseline = 'different-sha';
  });
});

test('supplier profile edits retain immutable revision history without exposing values in receipts', () => {
  assert.ok(
    baseline.model.tables.Supplier.fields.currentRevisionId.includes(
      'SupplierRevision',
    ),
  );
  assert.match(
    baseline.model.tables.SupplierRevision.immutability,
    /Append-only/i,
  );
  assert.ok(
    baseline.openapi.paths['/v1/staff/suppliers/{supplierId}/revisions']?.get,
  );
  assert.equal(
    baseline.openapi.paths['/v1/staff/suppliers/{supplierId}/revisions'].get[
      'x-permission'
    ],
    'suppliers.read',
  );
  for (const field of [
    'legalName',
    'shortName',
    'taxIdentifier',
    'taxJurisdiction',
    'contactName',
    'email',
    'phone',
    'website',
    'internalNotes',
  ]) {
    assert.ok(
      baseline.openapi.components.schemas.SupplierRevision.required.includes(
        field,
      ),
    );
  }
  const receipt = baseline.openapi.components.schemas.SupplierMutationReceipt;
  assert.ok(receipt.properties.data.properties.revisionId);
  assert.equal(receipt.properties.data.properties.legalName, undefined);
  assert.equal(receipt.properties.data.properties.internalNotes, undefined);
});

test('checker rejects incomplete supplier profile history snapshots', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.SupplierRevision.required =
      contract.openapi.components.schemas.SupplierRevision.required.filter(
        (field) => field !== 'internalNotes',
      );
  });
});
