import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadR1_010(root = here) {
  const base = root === here ? here : path.resolve(root, 'docs/contracts');
  const readJson = async (name) =>
    JSON.parse(await readFile(path.join(base, name), 'utf8'));
  return {
    model: await readJson('R1-010-inquiry-data-model.json'),
    rbac: await readJson('R1-010-inquiry-rbac-matrix.json'),
    audit: await readJson('R1-010-inquiry-audit-registry.json'),
    openapi: await readJson('R1-010-inquiries.openapi.json'),
    domain: await readFile(
      path.join(base, 'R1-010-inquiry-domain-contract.md'),
      'utf8',
    ),
    lifecycle: await readFile(
      path.join(base, 'R1-010-inquiry-state-machine.md'),
      'utf8',
    ),
    attachment: await readFile(
      path.join(base, 'R1-010-attachment-security-policy.md'),
      'utf8',
    ),
    decisions: await readFile(
      path.resolve(base, '../plans/R1-010-owner-decisions.md'),
      'utf8',
    ),
    matrix: await readFile(path.join(base, 'R1-010-test-matrix.md'), 'utf8'),
  };
}

export function validateR1_010(c) {
  const errors = [];
  const fail = (message) => errors.push(message);
  const expectedPermissions = [
    'inquiries.assign_engineer',
    'inquiries.assign_manager',
    'inquiries.comment',
    'inquiries.contacts.read',
    'inquiries.documents.download',
    'inquiries.documents.read',
    'inquiries.read_all',
    'inquiries.read_assigned',
    'inquiries.transition',
  ];
  const expectedTables = [
    'Inquiry',
    'InquiryCommandIdempotency',
    'InquiryComment',
    'InquiryLine',
    'InquirySourceDocument',
    'InquiryUploadIntent',
  ];
  const expectedPublicOperations = [
    'cancelInquiryUploadIntent',
    'createInquiryUploadIntent',
    'createPublicInquiry',
    'uploadInquirySourceDocument',
  ];
  const expectedStaffOperations = [
    'assignInquiryEngineer',
    'assignInquiryManager',
    'createStaffInquiryComment',
    'downloadStaffInquiryDocument',
    'getStaffInquiry',
    'listInquiryEvents',
    'listStaffInquiryComments',
    'listStaffInquiryDocuments',
    'listStaffInquiries',
    'setInquiryStageDeadline',
    'transitionStaffInquiry',
  ];

  if (c.model.status !== 'PROPOSED' || c.model.version !== '0.1.0-proposed') {
    fail('model must remain PROPOSED 0.1.0-proposed');
  }
  if (
    [...c.model.newTables].sort().join('|') !== expectedTables.join('|') ||
    Object.keys(c.model.tables).sort().join('|') !== expectedTables.join('|')
  ) {
    fail('the package must define exactly six proposed Inquiry tables');
  }
  if (
    !c.model.reusedTables.includes('AuditEvent') ||
    !c.model.reusedTables.includes('StaffUser') ||
    !c.model.rules.fileStorage.includes('Do not reuse R1-002 FileObject')
  ) {
    fail(
      'Inquiry must reuse the existing audit/staff boundary without using staff-owned generic files',
    );
  }
  if (
    !c.model.tables.InquirySourceDocument.compositeForeignKeys?.some(
      (fk) =>
        fk.fields.join('|') === 'uploadIntentId|inquiryId' &&
        fk.references === 'InquiryUploadIntent(id,inquiryId)',
    )
  ) {
    fail('source document must be DB-bound to the same Inquiry as its intent');
  }

  if (c.rbac.defaultDeny !== true || c.rbac.automaticRoleGrants !== false) {
    fail('RBAC must be default-deny with no automatic role grants');
  }
  if (
    Object.keys(c.rbac.permissions).sort().join('|') !==
    expectedPermissions.join('|')
  ) {
    fail('proposed permission catalog drifted');
  }
  if (
    [...c.openapi['x-permissions']].sort().join('|') !==
    expectedPermissions.join('|')
  ) {
    fail('OpenAPI permission list differs from the RBAC contract');
  }

  const operationEntries = [];
  for (const [route, pathItem] of Object.entries(c.openapi.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      operationEntries.push({ route, method, operation });
    }
  }
  const publicOps = operationEntries
    .filter(({ route }) => route.startsWith('/v1/public/'))
    .map(({ operation }) => operation.operationId)
    .sort();
  const staffOps = operationEntries
    .filter(({ route }) => route.startsWith('/v1/staff/'))
    .map(({ operation }) => operation.operationId)
    .sort();
  if (
    publicOps.join('|') !== expectedPublicOperations.sort().join('|') ||
    staffOps.join('|') !== expectedStaffOperations.sort().join('|') ||
    operationEntries.length !== 15
  ) {
    fail(
      'OpenAPI must contain exactly 15 operations: four public and eleven staff',
    );
  }
  if (
    operationEntries.some(
      ({ route, method }) =>
        route.startsWith('/v1/public/inquiries') && method === 'get',
    )
  ) {
    fail('public Inquiry lookup/status routes are forbidden');
  }
  for (const { route, method, operation } of operationEntries) {
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      if (
        !operation.parameters?.some(
          (parameter) =>
            parameter.$ref === '#/components/parameters/IdempotencyKey',
        )
      ) {
        fail(`${method.toUpperCase()} ${route} must require Idempotency-Key`);
      }
    }
    if (
      [
        'assignInquiryManager',
        'assignInquiryEngineer',
        'setInquiryStageDeadline',
        'transitionStaffInquiry',
      ].includes(operation.operationId) &&
      !operation.parameters?.some(
        (parameter) => parameter.$ref === '#/components/parameters/IfMatch',
      )
    ) {
      fail(`${operation.operationId} must require If-Match`);
    }
    if (route.startsWith('/v1/staff/') && method !== 'get') {
      if (!operation.security?.some((scheme) => scheme.StaffSessionCookie)) {
        fail(`${operation.operationId} must use the FROZEN staff session`);
      }
      for (const name of ['StaffCsrf', 'Origin']) {
        if (
          !operation.parameters?.some(
            (parameter) => parameter.$ref === `#/components/parameters/${name}`,
          )
        ) {
          fail(`${operation.operationId} must require ${name}`);
        }
      }
    }
    if (
      route.includes('/upload-intents') &&
      !operation.security?.some((scheme) => scheme.InquiryUploadCapability)
    ) {
      fail(
        `${operation.operationId} must require the inquiry-bound upload capability`,
      );
    }
  }
  if (
    Object.keys(c.openapi['x-permission-rules'] ?? {})
      .sort()
      .join('|') !== expectedStaffOperations.join('|')
  ) {
    fail('every staff operation must have an explicit permission rule');
  }
  if (
    c.openapi.paths['/v1/public/inquiries']?.post?.responses?.['201'] ===
    undefined
  ) {
    fail('public create must return a persisted 201 receipt');
  }
  if (
    c.openapi.paths['/v1/public/inquiries']?.post?.['x-max-request-bytes'] !==
      2097152 ||
    c.openapi.components.schemas.CreateInquiryRequest.properties.equipmentLines
      .maxItems !== 50 ||
    c.openapi.components.schemas.PanelsDetails.properties.requestType.enum.join(
      '|',
    ) !== 'PROJECT_READY|MODIFY_TYPICAL|DEVELOP_FROM_BRIEF'
  ) {
    fail('public request body, line count or panel taxonomy drifted');
  }
  if (
    !c.openapi.components.schemas.ContactSnapshot.anyOf.some((branch) =>
      branch.required?.includes('email'),
    ) ||
    !c.openapi.components.schemas.ContactSnapshot.anyOf.some((branch) =>
      branch.required?.includes('phone'),
    )
  ) {
    fail('contact must provide at least one optional email/phone channel');
  }
  const receipt = c.openapi.components.schemas.PublicInquiryReceipt;
  if (
    receipt?.properties?.data?.properties?.status ||
    receipt?.properties?.data?.properties?.contact ||
    receipt?.properties?.data?.properties?.uploadCapability
  ) {
    fail('public receipt must not expose status, PII or upload capability');
  }
  const uploadReceipt =
    c.openapi.components.schemas.DocumentUploadReceipt?.properties?.data
      ?.properties;
  if (
    uploadReceipt?.documentId ||
    uploadReceipt?.sha256 ||
    uploadReceipt?.storageKey
  ) {
    fail(
      'public upload receipt must not reveal internal IDs, hashes or storage keys',
    );
  }
  if (
    Object.keys(c.openapi.paths).some((route) =>
      /orders|quotation|catalog-import|ingestion|spec-import/i.test(route),
    )
  ) {
    fail(
      'R1-010 OpenAPI contains an operation outside Inquiry/upload/staff scope',
    );
  }
  if (
    !c.openapi['x-invariants'].some((rule) =>
      /No public inquiry GET/.test(rule),
    ) ||
    !c.openapi['x-invariants'].some((rule) => /No external parser/.test(rule))
  ) {
    fail('OpenAPI must state the no-enumeration and no-parser boundaries');
  }
  if (
    c.openapi.paths['/v1/staff/inquiries/{inquiryId}/stage-deadline']?.put
      ?.operationId !== 'setInquiryStageDeadline' ||
    !c.openapi.components.schemas.InquirySummary.required.includes(
      'stageDueAt',
    ) ||
    c.openapi.components.schemas.AssignmentRequest.properties.staffUserId
      .type !== 'string' ||
    c.openapi.components.schemas.TransitionRequest.properties.internalNote
  ) {
    fail(
      'stage deadlines must be staff-visible, assignment clearing forbidden, and transition DTO must not imply an unpersisted note',
    );
  }
  if (
    !c.openapi['x-invariants'].some((rule) =>
      /Before replaying any staff mutation receipt, revalidate current session, CSRF\/Origin, action permission and inquiry read scope/.test(
        rule,
      ),
    ) ||
    !c.lifecycle.includes(
      'whose assignment/read scope was revoked cannot replay',
    )
  ) {
    fail('staff idempotency replay must reauthorize current Inquiry scope');
  }
  if (
    c.openapi.components.schemas.TransitionRequest.properties.reasonCode.enum.includes(
      'CLOSED_DUPLICATE',
    ) ||
    c.openapi.components.schemas.TransitionRequest.properties.reasonCode.enum.includes(
      'CLOSED_WITHOUT_QUOTE',
    ) ||
    !c.lifecycle.includes('Generic staff transitions cannot set CLOSED')
  ) {
    fail('generic Inquiry transitions must not bypass quote lifecycle closure');
  }
  const staffTargetStatuses =
    c.openapi.components.schemas.StaffTransitionTargetStatus?.enum ?? [];
  if (
    c.openapi.components.schemas.TransitionRequest.properties.toStatus.$ref !==
      '#/components/schemas/StaffTransitionTargetStatus' ||
    staffTargetStatuses.includes('QUOTE_SENT') ||
    staffTargetStatuses.includes('CLOSED') ||
    staffTargetStatuses.includes('NEW') ||
    c.openapi.components.schemas.TransitionRequest.properties.reasonCode.enum.includes(
      'QUOTE_WORK_READY',
    ) ||
    c.audit.actions
      .find((entry) => entry.action === 'inquiry.transitioned')
      .outcomes.SUCCESS.includes('QUOTE_WORK_READY')
  ) {
    fail(
      'staff transitions must exclude quote lifecycle targets and unused reasons',
    );
  }
  const publicCreate = c.openapi.paths['/v1/public/inquiries'].post;
  if (
    !publicCreate.requestBody.content['application/json'].schema.$ref.endsWith(
      'CreateInquiryRequest',
    ) ||
    !c.openapi.components.schemas.CreateInquiryRequest.properties
      .uploadCapability ||
    publicCreate.parameters.some(
      (parameter) =>
        parameter.$ref === '#/components/parameters/InquiryUploadCapability',
    ) ||
    !c.attachment.includes(
      'includes it as the `uploadCapability` field of the HTTPS Inquiry-creation JSON body',
    ) ||
    !c.attachment.includes('Creation has no capability header.') ||
    !c.attachment.includes(
      'For later upload-intent, byte-upload and cancel requests',
    ) ||
    !c.attachment.includes('X-Inquiry-Upload-Capability')
  ) {
    fail(
      'upload capability transport must distinguish create JSON from later request headers',
    );
  }
  if (
    !c.attachment.includes('RATE_LIMIT_KEY') ||
    !c.attachment.includes('inquiry-source:v1:') ||
    !c.attachment.includes('Do not add a new secret')
  ) {
    fail(
      'public source rate limits must reuse the domain-separated existing key',
    );
  }
  if (
    !c.model.tables.Inquiry.fields.stageDueAt ||
    !c.audit.actions.some(
      (entry) => entry.action === 'inquiry.stage_deadline.changed',
    ) ||
    !c.lifecycle.includes('A successful status transition clears `stageDueAt`')
  ) {
    fail(
      'stage deadline must have persisted field, audit action and reset semantics',
    );
  }
  const auditChangeKeys = new Set([
    'changedFields',
    'previousState',
    'state',
    'targetUserId',
    'version',
  ]);
  if (
    !c.audit.changesContract.schema.includes(
      'FROZEN R1-002 components.schemas.AuditChanges',
    ) ||
    Object.keys(c.audit.changesContract.allowedKeys).sort().join('|') !==
      [...auditChangeKeys].sort().join('|')
  ) {
    fail(
      'Inquiry audit changes must use only the frozen R1-002 AuditChanges DTO',
    );
  }
  for (const action of c.audit.actions) {
    if (
      !action.outcomes ||
      Array.isArray(action.outcomes) ||
      !Array.isArray(action.changesKeys) ||
      action.changesKeys.some((key) => !auditChangeKeys.has(key))
    ) {
      fail(
        `${action.action} must define per-action outcomes and closed changesKeys`,
      );
      continue;
    }
    for (const [outcome, reasonCodes] of Object.entries(action.outcomes)) {
      if (
        !Array.isArray(reasonCodes) ||
        (outcome !== 'SUCCESS' && reasonCodes.includes(null))
      ) {
        fail(
          `${action.action}/${outcome} must define valid non-null denied/failure reason codes`,
        );
      }
    }
  }
  const stageDeadlineAudit = c.audit.actions.find(
    (entry) => entry.action === 'inquiry.stage_deadline.changed',
  );
  if (
    !stageDeadlineAudit?.outcomes?.SUCCESS?.includes('STAGE_DUE_AT_SET') ||
    !stageDeadlineAudit?.outcomes?.SUCCESS?.includes('STAGE_DUE_AT_CLEARED') ||
    stageDeadlineAudit.changesKeys.some((key) => !auditChangeKeys.has(key))
  ) {
    fail(
      'stage deadline audit must define bounded reasons and frozen changes keys',
    );
  }
  if (
    !c.attachment.includes(
      'charged by declared bytes when an upload intent is accepted',
    ) ||
    !c.attachment.includes(
      'one Redis atomic operation enforces it across all Inquiries',
    ) ||
    !c.attachment.includes(
      'receivingDeadlineAt = receivingStartedAt + 15 minutes',
    ) ||
    !c.model.tables.InquiryUploadIntent.fields.receivingDeadlineAt
  ) {
    fail(
      'source-day quota and active-stream expiry rules must be deterministic',
    );
  }

  const redactedFields = new Set(
    c.audit.actions.flatMap((entry) => entry.redactions),
  );
  if (
    ![
      'contactSnapshot',
      'comment body',
      'capability',
      'storageKey',
      'IP',
      'bytes',
    ].every((field) => redactedFields.has(field))
  ) {
    fail('audit registry must redact all defined sensitive value classes');
  }
  if (
    !c.model.rules.atomicity.includes(
      'failed upload never rolls back the Inquiry',
    ) ||
    !c.attachment.includes('not malware clearance') ||
    !c.attachment.includes('state is QUARANTINED')
  ) {
    fail(
      'upload isolation, independent transaction and quarantine invariants are required',
    );
  }
  if (!c.lifecycle.includes('QUOTE_SENT -> CLOSED')) {
    fail('state machine must cover the approved terminal stages');
  }
  for (const id of [
    'OD-010-01',
    'OD-010-02',
    'OD-010-03',
    'OD-010-04',
    'OD-010-05',
  ]) {
    if (!c.decisions.includes(id)) fail(`owner decision ${id} is missing`);
  }
  for (let i = 1; i <= 35; i += 1) {
    const id = `REQB-${String(i).padStart(2, '0')}`;
    if (!c.matrix.includes(id)) fail(`acceptance scenario ${id} is missing`);
  }

  assert.equal(errors.length, 0, errors.join('\n'));
  return {
    tableCount: c.model.newTables.length,
    operationCount: operationEntries.length,
    publicOperationCount: publicOps.length,
    staffOperationCount: staffOps.length,
    permissionCount: expectedPermissions.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = validateR1_010(await loadR1_010());
  console.log(
    `R1-010 contract PASS: ${result.tableCount} new tables; ${result.operationCount} API operations (${result.publicOperationCount} public, ${result.staffOperationCount} staff); ${result.permissionCount} additive permissions; REQB-01..35 present.`,
  );
}
