import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const approvedSourceHead = '68fb60f87c7821044939dd5d95f8e67e6bb73685';
const frozenArtifactPaths = [
  'docs/contracts/R1-010-attachment-security-policy.md',
  'docs/contracts/R1-010-inquiries.openapi.json',
  'docs/contracts/R1-010-inquiry-audit-registry.json',
  'docs/contracts/R1-010-inquiry-data-model.json',
  'docs/contracts/R1-010-inquiry-domain-contract.md',
  'docs/contracts/R1-010-inquiry-rbac-matrix.json',
  'docs/contracts/R1-010-inquiry-rbac-matrix.md',
  'docs/contracts/R1-010-inquiry-state-machine.md',
  'docs/contracts/R1-010-inquiry-upload-profiles.json',
  'docs/contracts/R1-010-test-matrix.md',
  'docs/plans/R1-010-owner-decisions.md',
  'docs/plans/R1-010B-implementation-plan.md',
];

const normalizedBytes = (bytes) =>
  Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
const sha256 = (bytes) =>
  createHash('sha256').update(normalizedBytes(bytes)).digest('hex');

export async function loadR1_010(root = here) {
  const base = root === here ? here : path.resolve(root, 'docs/contracts');
  const readJson = async (name) =>
    JSON.parse(await readFile(path.join(base, name), 'utf8'));
  const frozenManifest = await readJson('R1-010-frozen-manifest.json');
  const repositoryRoot = path.resolve(base, '../..');
  const frozenArtifactSha256 = {};
  const approvedSourceSha256 = {};
  for (const artifactPath of frozenArtifactPaths) {
    frozenArtifactSha256[artifactPath] = sha256(
      await readFile(path.resolve(repositoryRoot, artifactPath)),
    );
    approvedSourceSha256[artifactPath] = sha256(
      execFileSync('git', ['show', `${approvedSourceHead}:${artifactPath}`], {
        cwd: repositoryRoot,
        maxBuffer: 5 * 1024 * 1024,
      }),
    );
  }
  return {
    model: await readJson('R1-010-inquiry-data-model.json'),
    rbac: await readJson('R1-010-inquiry-rbac-matrix.json'),
    audit: await readJson('R1-010-inquiry-audit-registry.json'),
    openapi: await readJson('R1-010-inquiries.openapi.json'),
    uploadProfiles: await readJson('R1-010-inquiry-upload-profiles.json'),
    domain: await readFile(
      path.join(base, 'R1-010-inquiry-domain-contract.md'),
      'utf8',
    ),
    lifecycle: await readFile(
      path.join(base, 'R1-010-inquiry-state-machine.md'),
      'utf8',
    ),
    rbacMarkdown: await readFile(
      path.join(base, 'R1-010-inquiry-rbac-matrix.md'),
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
    reviewReport: await readFile(
      path.resolve(base, '../plans/R1-010B-01-review-verification.md'),
      'utf8',
    ),
    implementationPlan: await readFile(
      path.resolve(base, '../plans/R1-010B-implementation-plan.md'),
      'utf8',
    ),
    frozenManifest,
    frozenArtifactSha256,
    approvedSourceSha256,
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

  if (
    c.model.status !== 'FROZEN' ||
    c.model.version !== '1.0.0' ||
    c.rbac.status !== 'FROZEN' ||
    c.rbac.version !== '1.0.0' ||
    c.audit.status !== 'FROZEN' ||
    c.audit.version !== '1.0.0' ||
    c.uploadProfiles.status !== 'FROZEN' ||
    c.uploadProfiles.version !== '1.0.0' ||
    c.openapi.info.version !== '1.0.0' ||
    c.openapi['x-contract-status'] !== 'FROZEN' ||
    c.openapi['x-contract-version'] !== '1.0.0'
  ) {
    fail('all R1-010 contract metadata must be FROZEN 1.0.0');
  }
  if (
    c.frozenManifest.contract !== 'R1-010 Public Inquiry Domain Contract' ||
    c.frozenManifest.status !== 'FROZEN' ||
    c.frozenManifest.version !== '1.0.0' ||
    c.frozenManifest.approval.sourceHead !== approvedSourceHead ||
    c.frozenManifest.approval.approvedOn !== '2026-10-26' ||
    !c.frozenManifest.approval.statement.includes(approvedSourceHead) ||
    !c.frozenManifest.approval.scope.includes(
      'does not authorize production migrations',
    ) ||
    c.frozenManifest.finalization.contractContentChanged !== false ||
    JSON.stringify(c.frozenManifest.approval.decisionIds) !==
      JSON.stringify([
        'OD-010-01',
        'OD-010-02',
        'OD-010-03',
        'OD-010-04',
        'OD-010-05',
      ])
  ) {
    fail('FROZEN approval provenance must match the owner-approved package');
  }
  if (
    JSON.stringify(c.frozenManifest.approvedSourceSha256) !==
      JSON.stringify(c.approvedSourceSha256) ||
    JSON.stringify(c.frozenManifest.frozenArtifactSha256) !==
      JSON.stringify(c.frozenArtifactSha256)
  ) {
    fail(
      'FROZEN R1-010 artifact checksums do not match the approved source and current files',
    );
  }
  if (
    JSON.stringify(
      Object.keys(c.frozenManifest.approvedSourceSha256).sort(),
    ) !== JSON.stringify([...frozenArtifactPaths].sort()) ||
    JSON.stringify(
      Object.keys(c.frozenManifest.frozenArtifactSha256).sort(),
    ) !== JSON.stringify([...frozenArtifactPaths].sort())
  ) {
    fail('FROZEN R1-010 checksum manifest must list the complete artifact set');
  }
  if (
    !c.domain.startsWith('# R1-010 — Public Inquiry Domain Contract') ||
    !c.domain.includes('**Status:** FROZEN.') ||
    !c.domain.includes('**Version:** 1.0.0.') ||
    !c.attachment.startsWith(
      '# R1-010 Public Attachment Security Policy — FROZEN 1.0.0',
    ) ||
    !c.rbacMarkdown.startsWith('# R1-010 Inquiry Permissions — FROZEN 1.0.0') ||
    !c.lifecycle.startsWith('# R1-010 Inquiry State Machine — FROZEN 1.0.0') ||
    !c.matrix.startsWith(
      '# R1-010 Inquiry Contract Acceptance Matrix — FROZEN 1.0.0',
    ) ||
    !c.decisions.startsWith('# R1-010 Owner Decisions — FROZEN 1.0.0') ||
    !c.decisions.includes('**Owner decision: APPROVED.**') ||
    !c.implementationPlan.includes('FROZEN R1-010 1.0.0') ||
    !c.reviewReport.includes('FROZEN 1.0.0 finalization')
  ) {
    fail(
      'FROZEN 1.0.0 status must be synchronized across contract and decision docs',
    );
  }
  if (
    [...c.model.newTables].sort().join('|') !== expectedTables.join('|') ||
    Object.keys(c.model.tables).sort().join('|') !== expectedTables.join('|')
  ) {
    fail('the package must define exactly six FROZEN Inquiry tables');
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
    fail('FROZEN permission catalog drifted');
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
  const panels = c.openapi.components.schemas.PanelsDetails;
  const engineering = c.openapi.components.schemas.EngineeringDetails;
  const contact = c.openapi.components.schemas.ContactSnapshot;
  if (
    panels.required.join('|') !== 'requestType|description' ||
    panels.properties.requirements.type.join('|') !== 'string|null' ||
    panels.properties.documentationAvailability.enum.join('|') !==
      'UNKNOWN|AVAILABLE|PARTIAL|NONE|' ||
    panels.properties.notes.maxLength !== 3000 ||
    engineering.required.join('|') !== 'technicalTask' ||
    !contact.required.includes('contactName') ||
    contact.properties.contactName.maxLength !== 180 ||
    !contact.properties.customerComment ||
    contact.properties.desiredDeadline.format ||
    contact.properties.desiredDeadline.maxLength !== 120
  ) {
    fail(
      'kind DTOs must preserve PR #18 form fields with only the accepted required constraints',
    );
  }
  const productContext =
    c.openapi.components.schemas.CreateInquiryRequest.properties
      .catalogProductContext;
  if (
    productContext?.maxLength !== 120 ||
    !/untrusted/i.test(productContext.description) ||
    !/never resolve/i.test(productContext.description)
  ) {
    fail('optional catalog product context must remain bounded and untrusted');
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
    c.openapi.components.schemas.StaffWorkflowTransitionRequest.properties
      .internalNote
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
  const closeReasons = [
    'DUPLICATE',
    'CUSTOMER_WITHDRAWN',
    'OUT_OF_SCOPE',
    'SPAM',
    'NOT_FEASIBLE',
  ];
  const transitionSchema = c.openapi.components.schemas.TransitionRequest;
  const transitionRefs =
    transitionSchema.oneOf?.map((branch) => branch.$ref) ?? [];
  const ordinaryTransition =
    c.openapi.components.schemas.StaffWorkflowTransitionRequest;
  const closeRequest =
    c.openapi.components.schemas.CloseInquiryWithoutQuoteRequest;
  const closureAudit = c.audit.actions.find(
    (entry) => entry.action === 'inquiry.closed_without_quote',
  );
  if (
    transitionRefs.join('|') !==
      '#/components/schemas/StaffWorkflowTransitionRequest|#/components/schemas/CloseInquiryWithoutQuoteRequest' ||
    ordinaryTransition.properties.toStatus.$ref !==
      '#/components/schemas/StaffTransitionTargetStatus' ||
    ordinaryTransition.properties.reasonCode.enum.some((reason) =>
      closeReasons.includes(reason),
    ) ||
    closeRequest.required.join('|') !== 'toStatus|reasonCode' ||
    closeRequest.properties.toStatus.const !== 'CLOSED' ||
    closeRequest.properties.reasonCode.$ref !==
      '#/components/schemas/InquiryClosureReason' ||
    c.openapi.components.schemas.InquiryClosureReason.enum.join('|') !==
      closeReasons.join('|') ||
    closeRequest['x-allowed-source-statuses']?.join('|') !==
      'NEW|TRIAGE|NEEDS_CLARIFICATION|ENGINEERING_REVIEW|READY_FOR_QUOTE' ||
    !closureAudit ||
    closureAudit.outcomes.SUCCESS.join('|') !== closeReasons.join('|') ||
    !c.lifecycle.includes('No path reopens CLOSED') ||
    !c.lifecycle.includes('current effective Inquiry read scope') ||
    !c.lifecycle.includes(
      'same-transaction state/version/AuditEvent/idempotency receipt',
    ) ||
    !c.lifecycle.includes('No quote or order is created') ||
    !c.lifecycle.includes('QUOTE_SENT is excluded from this command')
  ) {
    fail(
      'pre-quote closure must be a strict reasoned terminal branch with the agreed source-state, authority, audit, OCC and idempotency guards',
    );
  }
  const staffTargetStatuses =
    c.openapi.components.schemas.StaffTransitionTargetStatus?.enum ?? [];
  if (
    staffTargetStatuses.includes('QUOTE_SENT') ||
    staffTargetStatuses.includes('CLOSED') ||
    staffTargetStatuses.includes('NEW') ||
    c.openapi.components.schemas.StaffWorkflowTransitionRequest.properties.reasonCode.enum.includes(
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
    !c.attachment.includes('Do not add a secret')
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
    !/A successful status transition.*clears `stageDueAt`/.test(c.lifecycle)
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
      'charge declared bytes by one Redis atomic operation when an upload intent is accepted',
    ) ||
    !c.model.rules.uploadQuotaConcurrency.includes(
      'one atomic Redis counter across all Inquiry IDs',
    ) ||
    !c.model.tables.InquiryUploadIntent.fields.receivingDeadlineAt.includes(
      '15 minutes MVP_SAFE; 60 minutes ENGINEERING_DOCUMENTS',
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
  const profiles = c.uploadProfiles.profiles;
  const shared = c.uploadProfiles.sharedControls;
  if (
    c.uploadProfiles.status !== 'FROZEN' ||
    c.uploadProfiles.defaultProfile !== 'MVP_SAFE' ||
    c.uploadProfiles.profileSelection.owner !==
      'server deployment configuration only; anonymous request cannot select or raise a profile' ||
    shared.allowedFormats.join('|') !== 'PDF|CSV|XLSX' ||
    shared.maxApplicationBufferPerStreamBytes !== 1048576 ||
    shared.maxConcurrentStreamsPerApiInstance !== 4 ||
    shared.maxConcurrentStreamsPerSource !== 2 ||
    profiles.MVP_SAFE.maxFileBytes !== 10485760 ||
    profiles.MVP_SAFE.maxFilesPerInquiry !== 5 ||
    profiles.MVP_SAFE.maxCompletedBytesPerInquiry !== 26214400 ||
    profiles.MVP_SAFE.maxDeclaredBytesPerSourceUtcDay !== 104857600 ||
    profiles.MVP_SAFE.uploadIntentsPerSourcePerHour !== 10 ||
    profiles.ENGINEERING_DOCUMENTS.maxFileBytes !== 52428800 ||
    profiles.ENGINEERING_DOCUMENTS.maxFilesPerInquiry !== 20 ||
    profiles.ENGINEERING_DOCUMENTS.maxCompletedBytesPerInquiry !== 262144000 ||
    profiles.ENGINEERING_DOCUMENTS.maxDeclaredBytesPerSourceUtcDay !==
      1073741824 ||
    profiles.ENGINEERING_DOCUMENTS.uploadIntentsPerSourcePerHour !== 40 ||
    profiles.MVP_SAFE.formats.join('|') !== 'PDF|CSV|XLSX' ||
    profiles.ENGINEERING_DOCUMENTS.formats.join('|') !== 'PDF|CSV|XLSX' ||
    !['DOCX', 'DWG', 'DXF', 'ZIP', '7Z', 'RAR'].every((format) =>
      c.uploadProfiles.excludedPendingSeparateReview.includes(format),
    ) ||
    !c.attachment.includes(
      'Colleagues behind the same NAT/VPN share the cap',
    ) ||
    !c.attachment.includes('document-led fabrication cannot proceed') ||
    !c.attachment.includes('no operational scanner')
  ) {
    fail(
      'the two FROZEN upload profiles, shared-source effects and scanner/format gates must remain explicit and bounded',
    );
  }
  if (
    !c.reviewReport.includes('R1-010A read-only compatibility matrix') ||
    !/preview-only/i.test(c.reviewReport) ||
    !/not integrated/i.test(c.reviewReport) ||
    !/contactName.*at least one valid `email` or `phone`/.test(c.reviewReport)
  ) {
    fail(
      'the PR #18 compatibility report must preserve the explicit preview-only and required-contact gaps',
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
  const matrixIds = [...c.matrix.matchAll(/\| (REQB-\d{2}) \|/g)].map(
    (match) => match[1],
  );
  const expectedMatrixIds = Array.from(
    { length: 41 },
    (_, i) => `REQB-${String(i + 1).padStart(2, '0')}`,
  );
  if (matrixIds.join('|') !== expectedMatrixIds.join('|')) {
    fail(
      'acceptance matrix must contain exactly REQB-01 through REQB-41 once and in order',
    );
  }
  for (let i = 1; i <= 41; i += 1) {
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
    `FROZEN R1-010 1.0.0 contract PASS: ${result.tableCount} new tables; ${result.operationCount} API operations (${result.publicOperationCount} public, ${result.staffOperationCount} staff); ${result.permissionCount} additive permissions; REQB-01..41 and approved-source/frozen-artifact checksums verified.`,
  );
}
