import { readFile } from 'node:fs/promises';

const [contractPath, generatedPath] = process.argv.slice(2);
if (!contractPath || !generatedPath)
  throw new Error('Usage: inquiry-openapi-contract.mjs <frozen> <generated>');
const contract = JSON.parse(await readFile(contractPath, 'utf8'));
const generated = JSON.parse(await readFile(generatedPath, 'utf8'));
const operations = (document) =>
  Object.entries(document.paths ?? {})
    .flatMap(([path, item]) =>
      Object.entries(item)
        .filter(
          ([, operation]) =>
            operation &&
            typeof operation === 'object' &&
            'operationId' in operation,
        )
        .map(([method, operation]) => ({
          path,
          method,
          operationId: operation.operationId,
        })),
    )
    .sort((a, b) =>
      `${a.path}:${a.method}`.localeCompare(`${b.path}:${b.method}`),
    );
const expected = operations(contract);
const actual = operations(generated);
const findOperation = (document, operationId) => {
  for (const [path, item] of Object.entries(document.paths ?? {}))
    for (const [method, operation] of Object.entries(item))
      if (operation?.operationId === operationId)
        return { path, method, operation };
  return null;
};
const operationResponseStatuses = (operation) =>
  Object.keys(operation?.responses ?? {}).sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
const requiredParameters = (operation) =>
  (operation?.parameters ?? [])
    .filter((parameter) => parameter?.required === true || parameter?.$ref)
    .map((parameter) => parameter.$ref ?? `${parameter.in}:${parameter.name}`)
    .sort();
const allowsNull = (schema) =>
  Array.isArray(schema?.type)
    ? schema.type.includes('null')
    : schema?.type === 'null' ||
      schema?.enum?.includes(null) === true ||
      schema?.anyOf?.some((variant) => allowsNull(variant)) === true;
const nullableSchemaLeaks = [];
const findNullableSchemaLeaks = (value, location = '$') => {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      findNullableSchemaLeaks(child, `${location}[${index}]`),
    );
  } else if (value && typeof value === 'object') {
    if (value.nullable === true) nullableSchemaLeaks.push(location);
    for (const [key, child] of Object.entries(value))
      findNullableSchemaLeaks(child, `${location}.${key}`);
  }
};
findNullableSchemaLeaks(generated);
if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  console.error(
    'Inquiry controller route inventory does not match FROZEN R1-010 OpenAPI.',
  );
  console.error('Expected:', JSON.stringify(expected, null, 2));
  console.error('Actual:', JSON.stringify(actual, null, 2));
  process.exitCode = 1;
} else {
  const mismatchedResponses = expected
    .map(({ path, method }) => ({
      path,
      method,
      expected: operationResponseStatuses(contract.paths[path]?.[method]),
      actual: operationResponseStatuses(generated.paths[path]?.[method]),
    }))
    .filter(
      ({ expected: wanted, actual: found }) =>
        JSON.stringify(wanted) !== JSON.stringify(found),
    );
  const mismatchedRequiredParameters = expected
    .map(({ path, method }) => ({
      path,
      method,
      expected: requiredParameters(contract.paths[path]?.[method]),
      actual: requiredParameters(generated.paths[path]?.[method]),
    }))
    .filter(
      ({ expected: wanted, actual: found }) =>
        JSON.stringify(wanted) !== JSON.stringify(found),
    );
  const missingErrorBodies = expected.flatMap(({ path, method }) => {
    const expectedOperation = contract.paths[path]?.[method];
    const actualOperation = generated.paths[path]?.[method];
    return Object.entries(expectedOperation?.responses ?? {})
      .filter(([status]) => !status.startsWith('2'))
      .filter(([status, expectedResponse]) => {
        const expectedHasJsonBody = Boolean(
          expectedResponse?.content?.['application/json'],
        );
        if (!expectedHasJsonBody) return false;
        const actualResponse = actualOperation?.responses?.[status];
        return !actualResponse?.content?.['application/json'];
      })
      .map(([status]) => `${method.toUpperCase()} ${path} ${status}`);
  });
  const responseParityFailure = Boolean(
    mismatchedResponses.length ||
    mismatchedRequiredParameters.length ||
    missingErrorBodies.length,
  );
  if (responseParityFailure) {
    console.error('Inquiry OpenAPI response/header contract parity failed.');
    console.error(
      JSON.stringify(
        {
          mismatchedResponses,
          mismatchedRequiredParameters,
          missingErrorBodies,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
  const attachmentOperations = actual.filter(({ path }) =>
    path.includes('/inquiry-attachments/'),
  );
  const invalidAttachmentOperation = attachmentOperations.find(
    ({ path, method }) => {
      const operation = generated.paths[path]?.[method];
      return (
        path.includes('{inquiryId}') ||
        operation?.security?.[0]?.InquiryUploadCapability === undefined ||
        operation?.parameters?.some(
          (parameter) =>
            parameter.$ref === '#/components/parameters/InquiryId' ||
            parameter.name === 'inquiryId',
        )
      );
    },
  );
  if (
    attachmentOperations.length !== 3 ||
    invalidAttachmentOperation ||
    generated.components?.securitySchemes?.InquiryUploadCapability?.name !==
      'X-Inquiry-Upload-Capability'
  ) {
    console.error(
      'Inquiry attachment operations must use the capability-only Amendment 01 routes and header security.',
    );
    process.exitCode = 1;
  } else {
    const transition = findOperation(generated, 'transitionStaffInquiry');
    const transitionSchema =
      transition?.operation?.requestBody?.content?.['application/json']?.schema;
    const transitionVariants = transitionSchema?.oneOf;
    const ordinary = transitionVariants?.find(
      (variant) =>
        variant?.properties?.toStatus?.enum?.includes('TRIAGE') &&
        !variant?.properties?.toStatus?.enum?.includes('CLOSED'),
    );
    const closure = transitionVariants?.find(
      (variant) =>
        variant?.properties?.toStatus?.enum?.includes('CLOSED') ||
        variant?.properties?.toStatus?.const === 'CLOSED',
    );
    const rawUpload = findOperation(generated, 'uploadInquirySourceDocument');
    const rawUploadSchema =
      rawUpload?.operation?.requestBody?.content?.['application/octet-stream']
        ?.schema;
    const createInquiry = findOperation(generated, 'createPublicInquiry');
    const createVariants =
      createInquiry?.operation?.requestBody?.content?.['application/json']
        ?.schema?.oneOf;
    const expectedKinds = [
      ['EQUIPMENT', 'equipmentLines'],
      ['PANELS', 'panels'],
      ['ENGINEERING', 'engineering'],
    ];
    const createSchemaValid =
      Array.isArray(createVariants) &&
      createVariants.length === expectedKinds.length &&
      expectedKinds.every(([kind, requiredDetail]) =>
        createVariants.some(
          (variant) =>
            variant?.additionalProperties === false &&
            JSON.stringify(variant?.required ?? []).includes('"contact"') &&
            JSON.stringify(variant?.required ?? []).includes(
              JSON.stringify(requiredDetail),
            ) &&
            JSON.stringify(variant?.properties?.kind?.enum ?? []) ===
              JSON.stringify([kind]),
        ),
      );
    const contactAnyOf =
      generated.components?.schemas?.ContactSnapshotDto?.anyOf;
    const contactChannelRule =
      Array.isArray(contactAnyOf) &&
      contactAnyOf.length === 2 &&
      contactAnyOf.some(
        (variant) =>
          variant?.required?.includes('email') &&
          variant?.properties?.email?.type === 'string',
      ) &&
      contactAnyOf.some(
        (variant) =>
          variant?.required?.includes('phone') &&
          variant?.properties?.phone?.type === 'string',
      );
    const createNullability =
      Array.isArray(createVariants) &&
      ['catalogProductContext', 'uploadCapability', 'privacyNotice'].every(
        (field) =>
          createVariants.every((variant) =>
            allowsNull(variant?.properties?.[field]),
          ),
      );
    const contactNullability = [
      'email',
      'phone',
      'organization',
      'region',
    ].every((field) =>
      allowsNull(
        generated.components?.schemas?.ContactSnapshotDto?.properties?.[field],
      ),
    );
    const uploadNullability = allowsNull(
      findOperation(generated, 'createInquiryUploadIntent')?.operation
        ?.requestBody?.content?.['application/json']?.schema?.properties
        ?.expectedSha256,
    );
    const panelsSchema = generated.components?.schemas?.PanelsDetailsDto;
    const requestedWorkSchema = panelsSchema?.properties?.requestedWork?.items;
    const stageDeadline = findOperation(generated, 'setInquiryStageDeadline');
    const stageDeadlineSchema =
      stageDeadline?.operation?.requestBody?.content?.['application/json']
        ?.schema;
    const stageDeadlineName = stageDeadlineSchema?.$ref?.split('/').at(-1);
    const stageDueAtFormat =
      stageDeadlineSchema?.properties?.stageDueAt?.format ??
      generated.components?.schemas?.[stageDeadlineName]?.properties?.stageDueAt
        ?.format;
    const comment = findOperation(generated, 'createStaffInquiryComment');
    const commentSchema =
      comment?.operation?.requestBody?.content?.['application/json']?.schema;
    const commentName = commentSchema?.$ref?.split('/').at(-1);
    const commentBodyPattern =
      commentSchema?.properties?.body?.pattern ??
      generated.components?.schemas?.[commentName]?.properties?.body?.pattern;
    const etagOperations = [
      'getStaffInquiry',
      'assignInquiryManager',
      'assignInquiryEngineer',
      'setInquiryStageDeadline',
      'transitionStaffInquiry',
    ];
    const missingEtag = etagOperations.find((operationId) => {
      const found = findOperation(generated, operationId);
      return !Object.values(found?.operation?.responses ?? {}).some(
        (response) => response?.headers?.ETag,
      );
    });
    if (
      responseParityFailure ||
      generated.info?.version !== '1.0.2' ||
      transitionVariants?.length !== 2 ||
      !ordinary?.properties?.toStatus?.enum?.includes('READY_FOR_QUOTE') ||
      ordinary?.properties?.toStatus?.enum?.includes('QUOTE_SENT') ||
      !closure?.properties?.toStatus?.enum?.includes('CLOSED') ||
      closure?.properties?.toStatus?.enum?.includes('QUOTE_SENT') ||
      rawUploadSchema?.type !== 'string' ||
      rawUploadSchema?.format !== 'binary' ||
      missingEtag ||
      !createSchemaValid ||
      !contactChannelRule ||
      requestedWorkSchema?.maxLength !== 500 ||
      stageDueAtFormat !== 'date-time' ||
      typeof commentBodyPattern !== 'string' ||
      !new RegExp(commentBodyPattern).test('a') ||
      new RegExp(commentBodyPattern).test(' ') ||
      nullableSchemaLeaks.length > 0 ||
      !createNullability ||
      !contactNullability ||
      !uploadNullability ||
      !allowsNull(stageDeadlineSchema?.properties?.stageDueAt)
    ) {
      console.error(
        'Implemented Inquiry OpenAPI is missing one or more required Amendment 01 contract details.',
      );
      console.error(
        JSON.stringify(
          {
            version: generated.info?.version,
            transitionVariants,
            rawUploadSchema,
            missingEtag,
            createVariants,
            contactAnyOf,
            requestedWorkSchema,
            stageDueAtFormat,
            commentBodyPattern,
            nullableSchemaLeaks,
            createNullability,
            contactNullability,
            uploadNullability,
            stageDueAtNullable: allowsNull(
              stageDeadlineSchema?.properties?.stageDueAt,
            ),
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    } else {
      console.log(
        `PASS implemented Inquiry OpenAPI matches FROZEN Amendment 01 (${actual.length} operations; strict transitions, raw upload, ETags, capability-only routes).`,
      );
    }
  }
}
