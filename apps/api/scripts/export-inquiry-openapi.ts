import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInquiryRuntimeOpenApi } from '../src/openapi/export.js';

function normalizeNullableSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNullableSchemas);
  if (!value || typeof value !== 'object') return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeNullableSchemas(child),
    ]),
  ) as Record<string, unknown>;
  if (normalized.nullable !== true) return normalized;
  delete normalized.nullable;
  if (typeof normalized.type === 'string') {
    normalized.type =
      normalized.type === 'null' ? 'null' : [normalized.type, 'null'];
    if (Array.isArray(normalized.enum) && !normalized.enum.includes(null))
      normalized.enum.push(null);
    return normalized;
  }
  if (Array.isArray(normalized.type)) {
    if (!normalized.type.includes('null')) normalized.type.push('null');
    if (Array.isArray(normalized.enum) && !normalized.enum.includes(null))
      normalized.enum.push(null);
    return normalized;
  }
  return { anyOf: [normalized, { type: 'null' }] };
}

const output = resolve(
  process.cwd(),
  '../../.local/contracts/generated-inquiry.openapi.json',
);
await mkdir(resolve(output, '..'), { recursive: true });
try {
  const document = await createInquiryRuntimeOpenApi();
  const frozen = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        '../../docs/contracts/R1-010-inquiries.openapi.json',
      ),
      'utf8',
    ),
  ) as {
    openapi: string;
    paths: Record<string, Record<string, Record<string, unknown>>>;
    components: Record<string, Record<string, unknown>>;
    security?: unknown;
  };
  document.openapi = '3.1.0';
  document.components ??= {};
  document.components.schemas = {
    ...frozen.components.schemas,
    ...document.components.schemas,
  };
  document.components.parameters = {
    ...frozen.components.parameters,
    ...document.components.parameters,
  };
  document.components.responses = {
    ...frozen.components.responses,
    ...document.components.responses,
  };
  document.components.securitySchemes = {
    ...document.components.securitySchemes,
    StaffSessionCookie: document.components.securitySchemes?.staffCookie,
  };
  if (frozen.security === undefined) delete document.security;
  else document.security = frozen.security;
  for (const [path, pathItem] of Object.entries(frozen.paths)) {
    for (const [method, contractOperation] of Object.entries(pathItem)) {
      const operation = document.paths[path]?.[method];
      if (!operation)
        throw new Error(`Missing runtime operation ${method} ${path}.`);
      for (const key of [
        'tags',
        'summary',
        'description',
        'security',
        'parameters',
        'responses',
      ])
        if (contractOperation[key] !== undefined)
          operation[key] = structuredClone(contractOperation[key]);
    }
  }
  const privacyDescription = (
    frozen.components.schemas.CreateInquiryRequest as {
      properties?: Record<string, { description?: string }>;
    }
  ).properties?.privacyNotice?.description;
  const create = document.paths['/v1/public/inquiries']?.post as
    | {
        requestBody?: {
          content?: Record<string, { schema?: Record<string, unknown> }>;
        };
      }
    | undefined;
  const variants =
    create?.requestBody?.content?.['application/json']?.schema?.oneOf;
  if (privacyDescription && Array.isArray(variants))
    for (const variant of variants)
      if (variant && typeof variant === 'object') {
        const properties = (variant as { properties?: Record<string, unknown> })
          .properties;
        const privacy = properties?.privacyNotice as
          Record<string, unknown> | undefined;
        if (privacy)
          privacy.description = `${privacyDescription} In this implementation a non-null notice currently returns 400 LEGAL_REVIEW_REQUIRED; public collection stays disabled until legal approval.`;
      }
  const normalizedDocument = normalizeNullableSchemas(document);
  await writeFile(
    output,
    `${JSON.stringify(normalizedDocument, null, 2)}\n`,
    'utf8',
  );
  console.log(`Generated Inquiry OpenAPI: ${output}`);
} catch (error) {
  console.error(
    'Inquiry OpenAPI export failed:',
    error instanceof Error ? error.message : 'unknown',
  );
  process.exitCode = 1;
}
