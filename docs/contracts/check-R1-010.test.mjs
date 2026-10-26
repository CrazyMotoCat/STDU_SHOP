import assert from 'node:assert/strict';
import test from 'node:test';
import { loadR1_010, validateR1_010 } from './check-R1-010.mjs';

const baseline = await loadR1_010();

function clone() {
  return structuredClone(baseline);
}

function rejects(change) {
  const contract = clone();
  change(contract);
  assert.throws(() => validateR1_010(contract));
}

test('proposed Inquiry contract has six tables, fifteen operations and nine permissions', () => {
  assert.deepEqual(validateR1_010(baseline), {
    tableCount: 6,
    operationCount: 15,
    publicOperationCount: 4,
    staffOperationCount: 11,
    permissionCount: 9,
  });
});

test('public inquiry lookup/status route is rejected', () => {
  rejects((contract) => {
    contract.openapi.paths['/v1/public/inquiries/{inquiryId}'] = {
      get: { operationId: 'publicReadInquiry' },
    };
  });
});

test('mutation missing durable idempotency is rejected', () => {
  rejects((contract) => {
    contract.openapi.paths[
      '/v1/staff/inquiries/{inquiryId}/transition'
    ].post.parameters = contract.openapi.paths[
      '/v1/staff/inquiries/{inquiryId}/transition'
    ].post.parameters.filter(
      (parameter) =>
        parameter.$ref !== '#/components/parameters/IdempotencyKey',
    );
  });
});

test('automatic permission grants and protected defaults are rejected', () => {
  rejects((contract) => {
    contract.rbac.automaticRoleGrants = true;
  });
});

test('staff operation without an explicit permission rule is rejected', () => {
  rejects((contract) => {
    delete contract.openapi['x-permission-rules'].downloadStaffInquiryDocument;
  });
});

test('idempotency receipt cannot expose status, PII or upload capability', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.PublicInquiryReceipt.properties.data.properties.status =
      { type: 'string' };
  });
});

test('source document and upload intent must use a same-inquiry composite FK', () => {
  rejects((contract) => {
    contract.model.tables.InquirySourceDocument.compositeForeignKeys = [];
  });
});

test('panel taxonomy cannot drift from the approved request shape proposal', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.PanelsDetails.properties.requestType.enum =
      ['READY_PROJECT'];
  });
});

test('public input bounds stay aligned with the create JSON body limit', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.CreateInquiryRequest.properties.equipmentLines.maxItems = 100;
  });
});

test('R1-010 cannot add a customer order or parser route', () => {
  rejects((contract) => {
    contract.openapi.paths['/v1/public/orders'] = {
      post: { operationId: 'createOrder' },
    };
  });
});

test('owner-supplied and added security acceptance cases are traced', () => {
  const ids = [...baseline.matrix.matchAll(/\| (REQB-\d{2}) \|/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    ids,
    Array.from(
      { length: 35 },
      (_, i) => `REQB-${String(i + 1).padStart(2, '0')}`,
    ),
  );
});

test('staff mutation replay is blocked when current Inquiry scope is lost', () => {
  rejects((contract) => {
    contract.lifecycle = contract.lifecycle.replace(
      'whose assignment/read scope was revoked cannot replay',
      'may replay even after assignment/read scope is revoked',
    );
  });
});

test('transition DTO cannot carry an unpersisted internal note or close state', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.TransitionRequest.properties.internalNote =
      {
        type: 'string',
      };
  });
  rejects((contract) => {
    contract.openapi.components.schemas.TransitionRequest.properties.reasonCode.enum.push(
      'CLOSED_DUPLICATE',
    );
  });
});

test('staff target enum excludes quote lifecycle states and unused reason codes', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.StaffTransitionTargetStatus.enum.push(
      'CLOSED',
    );
  });
  rejects((contract) => {
    contract.audit.actions
      .find((entry) => entry.action === 'inquiry.transitioned')
      .outcomes.SUCCESS.push('QUOTE_WORK_READY');
  });
});

test('assignments cannot be cleared and stage deadlines remain visible and audited', () => {
  rejects((contract) => {
    contract.openapi.components.schemas.AssignmentRequest.properties.staffUserId.type =
      ['string', 'null'];
  });
  rejects((contract) => {
    contract.openapi.paths[
      '/v1/staff/inquiries/{inquiryId}/stage-deadline'
    ].put.operationId = 'unexpectedOperation';
  });
  rejects((contract) => {
    contract.openapi.paths[
      '/v1/staff/inquiries/{inquiryId}/stage-deadline'
    ].put.parameters = contract.openapi.paths[
      '/v1/staff/inquiries/{inquiryId}/stage-deadline'
    ].put.parameters.filter(
      (parameter) => parameter.$ref !== '#/components/parameters/IfMatch',
    );
  });
});

test('capability transport is defined separately for creation and attachment commands', () => {
  rejects((contract) => {
    contract.attachment = contract.attachment.replace(
      'includes it as the `uploadCapability` field of the HTTPS Inquiry-creation JSON body',
      'The initial create request carries it only in a header',
    );
  });
});

test('anonymous rate limits reuse the existing key with an Inquiry-specific namespace', () => {
  rejects((contract) => {
    contract.attachment = contract.attachment.replace(
      'inquiry-source:v1:',
      'shared-source:',
    );
  });
});

test('audit actions declare reasons and only use the frozen AuditChanges keys', () => {
  rejects((contract) => {
    contract.audit.actions
      .find((entry) => entry.action === 'inquiry.stage_deadline.changed')
      .changesKeys.push('rawDeadline');
  });
  rejects((contract) => {
    contract.audit.actions
      .find((entry) => entry.action === 'inquiry.stage_deadline.changed')
      .outcomes.DENIED.push(null);
  });
});

test('quota counters cover cross-Inquiry concurrency and active stream expiry', () => {
  rejects((contract) => {
    contract.attachment = contract.attachment.replace(
      'one Redis atomic operation enforces it across all Inquiries',
      'one Redis operation per Inquiry',
    );
  });
  rejects((contract) => {
    delete contract.model.tables.InquiryUploadIntent.fields.receivingDeadlineAt;
  });
});
