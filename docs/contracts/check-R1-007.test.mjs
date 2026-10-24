import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSupplierContract,
  validateSupplierContract,
} from './check-R1-007.mjs';

const baseline = await loadSupplierContract();

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
