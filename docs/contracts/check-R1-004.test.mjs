import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadCatalogContract,
  validateCatalogContract,
} from './check-R1-004.mjs';

const baseline = await loadCatalogContract();

function rejects(change) {
  const changed = structuredClone(baseline);
  change(changed);
  assert.throws(() => validateCatalogContract(changed));
}

test('R1-004 catalog contracts are internally consistent', () => {
  assert.doesNotThrow(() => validateCatalogContract(baseline));
});

test('checker rejects thawed contract status or version', () => {
  for (const name of ['model', 'rbac', 'audit']) {
    rejects((c) => {
      c[name].status = 'PROPOSED';
    });
    rejects((c) => {
      c[name].version = '0.1.0-proposed';
    });
  }
  rejects((c) => {
    c.openapi['x-contract-status'] = 'PROPOSED / REVIEW_REQUIRED';
  });
  rejects((c) => {
    c.openapi.info.version = '0.1.0-proposed';
  });
});

test('checker rejects missing or changed owner approval provenance', () => {
  for (const name of ['model', 'rbac', 'audit']) {
    rejects((c) => {
      delete c[name].approvedSourceSha;
    });
  }
  rejects((c) => {
    c.openapi['x-approved-source-sha'] = 'unapproved';
  });
  for (const name of [
    'decisions',
    'matrix',
    'modelMarkdown',
    'rbacMarkdown',
    'implementationPlan',
  ]) {
    rejects((c) => {
      c[name] = c[name].replaceAll(
        '8ae4dd8cfd15e3722d97259818b238924851c963',
        'unapproved',
      );
    });
  }
});

test('checker rejects adding an out-of-scope supplier model', () => {
  rejects((c) => {
    c.model.tables.Supplier = {};
  });
});

test('checker rejects a catalog permission added to the proposed permission set', () => {
  rejects((c) => {
    c.rbac.permissions['catalog.admin'] = 'unbounded';
  });
});

test('checker rejects an OpenAPI permission that differs from RBAC mapping', () => {
  rejects((c) => {
    c.openapi.paths['/v1/staff/catalog/products'].post['x-permission'] =
      'catalog.admin';
  });
});

test('checker rejects unsafe staff route without Origin and CSRF', () => {
  rejects((c) => {
    c.openapi.paths[
      '/v1/staff/catalog/products/{productId}/review'
    ].post.parameters = [];
  });
});

test('checker rejects media route without frozen file metadata permission', () => {
  rejects((c) => {
    delete c.openapi.paths['/v1/staff/catalog/products/{productId}/media'].put[
      'x-required-permissions'
    ];
  });
});

test('checker rejects public exposure of a raw FileVersion identifier', () => {
  rejects((c) => {
    c.openapi.components.schemas.PublicCatalogProduct.properties.fileVersionId =
      { type: 'string' };
  });
});

test('checker rejects removal of CAT-03 public manual relations', () => {
  rejects((c) => {
    delete c.openapi.components.schemas.PublicCatalogProduct.properties
      .relations;
  });
});

test('checker rejects a price amount in the public contract', () => {
  rejects((c) => {
    c.openapi.components.schemas.PublicPriceDisplay.properties.amount = {
      type: 'number',
    };
  });
});

test('checker rejects staff product filters that do not follow current pointers', () => {
  rejects((c) => {
    c.openapi.paths['/v1/staff/catalog/products'].get['x-invariants'] = [];
  });
  rejects((c) => {
    c.openapi.components.parameters.ProductState.description =
      'Filter by the root publication state only.';
  });
  rejects((c) => {
    c.openapi.paths['/v1/staff/catalog/products'].get['x-invariants'][0] =
      'With ARCHIVED, categoryId matches retained pointers.';
  });
  rejects((c) => {
    delete c.openapi.paths['/v1/staff/catalog/products'].get.responses['400'];
  });
});

test('checker rejects edits to frozen R1-002 audit events', () => {
  rejects((c) => {
    c.frozenAudit.version = '1.0.1';
  });
});

test('checker rejects a missing required future runtime acceptance scenario', () => {
  rejects((c) => {
    c.matrix = c.matrix.replace('CATB-34', 'CATB-XX');
  });
});

for (const id of ['CATB-36', 'CATB-37', 'CATB-38']) {
  test(`checker requires ${id} in the frozen runtime acceptance matrix`, () => {
    rejects((c) => {
      c.matrix = c.matrix
        .split('\n')
        .filter((line) => !line.includes(id))
        .join('\n');
    });
  });
}

test('checker rejects a product PATCH without explicit base revision', () => {
  rejects((c) => {
    c.openapi.components.schemas.PatchCatalogProductDraft.required = [
      'expectedVersion',
    ];
  });
});

test('checker rejects a revision model without SUPERSEDED draft state', () => {
  rejects((c) => {
    c.model.tables.CatalogProductRevision.fields.state =
      'text NOT NULL DRAFT|PENDING_REVIEW|PUBLISHED|RETURNED|REJECTED|WITHDRAWN';
  });
});

test('checker rejects dynamically widened bootstrap permissions', () => {
  rejects((c) => {
    c.rbac.initialGrant.catalogPermissionCodes.push('catalog.future.write');
  });
});

test('checker rejects unbounded attribute text input', () => {
  rejects((c) => {
    c.openapi.components.schemas.CatalogAttributeInputTEXT.properties.value.maxLength = 5000;
  });
});

test('checker rejects numeric JSON number for DECIMAL wire input', () => {
  rejects((c) => {
    c.openapi.components.schemas.CatalogAttributeInputDECIMAL.properties.value.type =
      'number';
  });
});

test('checker rejects a non-bounded owner approval reference', () => {
  rejects((c) => {
    c.rbac.initialGrant.ownerApprovalReference = 'any operator text';
  });
});

test('checker rejects disallowing the empty q value from the owner contract', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get.parameters.find(
      (parameter) => parameter.name === 'q',
    ).schema.minLength = 1;
  });
});

test('checker rejects technical filters combined with includeDescendants=true', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].includeDescendantsRequiredValue = true;
  });
});

test('checker rejects technical filters accepting omitted includeDescendants', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].includeDescendantsMustBeExplicit = false;
  });
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get.parameters.find(
      (parameter) => parameter.name === 'includeDescendants',
    ).schema.default = false;
  });
});

test('checker rejects technical filters accepting missing categorySlug', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].categorySlugRequired = false;
  });
});

test('checker rejects automatic technical attribute code matching across categories', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].matchDefinitionsAcrossCategoriesByCode = true;
  });
});

test('checker rejects technical filters scoped to descendant definitions', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].attributeDefinitionScope = 'CATEGORY_AND_DESCENDANTS';
  });
});

test('checker preserves descendant search without technical filters', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/products'].get[
      'x-technical-filter-policy'
    ].descendantsAllowedWithoutFilter = false;
  });
});

test('checker rejects losing the 400 response for incompatible technical filter queries', () => {
  rejects((c) => {
    delete c.openapi.paths['/v1/public/catalog/products'].get.responses['400'];
  });
});

test('checker rejects OD-004A-06 without the explicit false requirement', () => {
  rejects((c) => {
    c.decisions = c.decisions.replace(
      'явно переданный `includeDescendants=false`',
      'автоматически выбранный includeDescendants',
    );
  });
});

test('checker rejects CATB-25 without the omitted/default-true negative case', () => {
  rejects((c) => {
    c.matrix = c.matrix.replace(
      'отсутствующим includeDescendants (default true)',
      'явно переданным includeDescendants',
    );
  });
});

test('checker rejects category parent semantics without active-parent locking', () => {
  rejects((c) => {
    c.model.tables.Category.treeMutation =
      'Category tree writes lock rows FOR UPDATE and reject CATEGORY_CYCLE';
  });
});

test('checker rejects category race matrix without archived-parent coverage', () => {
  rejects((c) => {
    c.matrix = c.matrix.replaceAll('CATEGORY_INACTIVE_PARENT', 'PARENT_ERROR');
  });
});

test('checker rejects an inactive-parent error omitted from API or audit contracts', () => {
  rejects((c) => {
    c.audit.actions['catalog.reference.changed'].outcomes.DENIED =
      c.audit.actions['catalog.reference.changed'].outcomes.DENIED.filter(
        (code) => code !== 'CATEGORY_INACTIVE_PARENT',
      );
  });
});

test('checker rejects unconstrained attribute definition type combinations', () => {
  rejects((c) => {
    c.openapi.components.schemas.CreateCatalogAttribute.allOf = [];
  });
});

test('checker rejects an unbounded recursive public category response', () => {
  rejects((c) => {
    c.openapi.components.schemas.PublicCatalogCategory.properties.children = {
      type: 'array',
      items: { $ref: '#/components/schemas/PublicCatalogCategory' },
    };
  });
});

test('checker rejects public category pages without a response-size cap', () => {
  rejects((c) => {
    delete c.openapi.components.schemas.PublicCatalogCategoryListResponse
      .properties.data.maxItems;
  });
});

test('checker rejects a staff collection missing pagination parameters', () => {
  rejects((c) => {
    c.openapi.paths['/v1/staff/catalog/categories'].get.parameters = [];
  });
});

test('checker rejects a page-number ceiling for public category navigation', () => {
  rejects((c) => {
    c.openapi.paths['/v1/public/catalog/categories'].get.parameters.push({
      name: 'page',
      in: 'query',
      schema: { type: 'integer', maximum: 10000 },
    });
  });
});

test('checker rejects missing root and revision identity synchronization', () => {
  rejects((c) => {
    delete c.model.identity.revisionSynchronization;
  });
});

test('checker rejects product archive without clearing current pointers', () => {
  rejects((c) => {
    delete c.model.tables.CatalogProduct.archiveMutation;
  });
  rejects((c) => {
    c.openapi.paths['/v1/staff/catalog/products/{productId}/archive'].post[
      'x-invariants'
    ] = ['Only hides the product from public search.'];
  });
  rejects((c) => {
    c.model.tables.CatalogProduct.checks =
      c.model.tables.CatalogProduct.checks.filter(
        (check) =>
          !check.includes('publicationState=ARCHIVED requires') ||
          !check.includes('all NULL'),
      );
  });
});

test('checker rejects category archival based on all historical revisions', () => {
  rejects((c) => {
    c.model.tables.Category.deletePolicy =
      'No hard delete; archive requires no category reference in any historical revision';
  });
});

test('checker rejects a category cursor contract without nonnegative sortOrder storage', () => {
  rejects((c) => {
    c.model.tables.Category.checks = c.model.tables.Category.checks.filter(
      (check) => check !== 'sortOrder >= 0',
    );
  });
});

test('checker rejects negative category sortOrder in the request schema', () => {
  rejects((c) => {
    delete c.openapi.components.schemas.CreateCatalogCategory.properties
      .sortOrder.minimum;
  });
});

test('checker rejects an unbounded character set for staff cursors', () => {
  rejects((c) => {
    delete c.openapi.components.parameters.StaffCursor.schema.pattern;
  });
});
