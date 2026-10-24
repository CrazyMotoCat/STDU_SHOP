import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [contract, runtime] = await Promise.all([
  readJson('docs/contracts/R1-007-suppliers.openapi.json'),
  readJson('.local/contracts/generated-supplier.openapi.json'),
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function operations(document) {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(
        ([method, operation]) =>
          ['get', 'post', 'patch', 'put', 'delete'].includes(method) &&
          operation &&
          typeof operation === 'object' &&
          'operationId' in operation,
      )
      .map(([method, operation]) => ({ path, method, operation })),
  );
}

function refName(value) {
  return typeof value?.$ref === 'string'
    ? value.$ref.slice(value.$ref.lastIndexOf('/') + 1)
    : undefined;
}

function responseSchema(document, response) {
  const resolved = refName(response)
    ? document.components.responses[refName(response)]
    : response;
  const schema = resolved?.content?.['application/json']?.schema;
  return { name: refName(schema), schema };
}

function canonicalSchema(document, schema, resolving = new Set()) {
  if (Array.isArray(schema))
    return schema.map((item) => canonicalSchema(document, item, resolving));
  if (!schema || typeof schema !== 'object') return schema;
  if (typeof schema.$ref === 'string') {
    const name = refName(schema);
    if (schema.$ref.startsWith('#/components/schemas/')) {
      assert.ok(document.components.schemas[name], `missing schema ${name}`);
      if (resolving.has(name)) return { $ref: name };
      const nextResolving = new Set(resolving).add(name);
      const resolved = canonicalSchema(
        document,
        document.components.schemas[name],
        nextResolving,
      );
      const siblings = Object.fromEntries(
        Object.entries(schema)
          .filter(([key]) => key !== '$ref' && key !== 'description')
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => [
            key,
            canonicalSchema(document, value, resolving),
          ]),
      );
      return mergeAllOf(
        Object.keys(siblings).length ? { ...resolved, ...siblings } : resolved,
      );
    }
  }
  const normalized = Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key]) =>
          !['description', 'dependentRequired', 'if', 'then'].includes(key),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        key === 'required' && Array.isArray(value)
          ? [...value].sort()
          : canonicalSchema(document, value, resolving),
      ]),
  );
  if (normalized.nullable === true && normalized.type) {
    const types = Array.isArray(normalized.type)
      ? [...normalized.type]
      : [normalized.type];
    normalized.type = [...new Set([...types, 'null'])].sort();
    delete normalized.nullable;
  }
  if (normalized.const !== undefined) {
    normalized.enum = [normalized.const];
    delete normalized.const;
  }
  if (normalized.unevaluatedProperties !== undefined) {
    normalized.additionalProperties = normalized.unevaluatedProperties;
    delete normalized.unevaluatedProperties;
  }
  return mergeAllOf(normalized);
}

function mergeAllOf(schema) {
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.allOf))
    return schema;
  const merged = { ...schema };
  delete merged.allOf;
  for (const branch of schema.allOf) {
    if (!branch || typeof branch !== 'object') continue;
    if (branch.properties)
      merged.properties = {
        ...(merged.properties ?? {}),
        ...branch.properties,
      };
    if (branch.required)
      merged.required = [
        ...new Set([...(merged.required ?? []), ...branch.required]),
      ].sort();
    for (const [key, value] of Object.entries(branch)) {
      if (['properties', 'required', 'type'].includes(key)) continue;
      if (merged[key] === undefined) merged[key] = value;
    }
    if (merged.type === undefined && branch.type !== undefined)
      merged.type = branch.type;
  }
  return merged;
}

function assertSchemaCompatible(expected, actual, context) {
  if (expected.type !== undefined) {
    const expectedTypes = new Set(
      Array.isArray(expected.type) ? expected.type : [expected.type],
    );
    const actualTypes = new Set(
      Array.isArray(actual.type) ? actual.type : [actual.type],
    );
    assert.ok(
      [...actualTypes].every((type) => expectedTypes.has(type)),
      `${context} response type drift`,
    );
  }
  for (const key of ['format', 'pattern'])
    if (expected[key] !== undefined)
      assert.equal(actual[key], expected[key], `${context} ${key} drift`);
  if (expected.enum)
    assert.ok(
      actual.enum &&
        actual.enum.every((value) => expected.enum.includes(value)),
      `${context} enum drift`,
    );
  for (const key of ['minimum', 'minLength', 'minItems'])
    if (expected[key] !== undefined)
      assert.ok(
        actual[key] !== undefined && actual[key] >= expected[key],
        `${context} ${key} drift`,
      );
  for (const key of ['maximum', 'maxLength', 'maxItems'])
    if (expected[key] !== undefined)
      assert.ok(
        actual[key] !== undefined && actual[key] <= expected[key],
        `${context} ${key} drift`,
      );
  if (expected.required)
    for (const key of expected.required)
      assert.ok(
        actual.required?.includes(key),
        `${context} missing required ${key}`,
      );
  if (expected.properties) {
    for (const [key, expectedProperty] of Object.entries(expected.properties)) {
      assert.ok(actual.properties?.[key], `${context} missing property ${key}`);
      assertSchemaCompatible(
        expectedProperty,
        actual.properties[key],
        `${context}.${key}`,
      );
    }
    if (expected.additionalProperties === false) {
      assert.equal(
        actual.additionalProperties,
        false,
        `${context} must be closed`,
      );
      assert.deepEqual(
        Object.keys(actual.properties ?? {}).sort(),
        Object.keys(expected.properties).sort(),
        `${context} property-set drift`,
      );
    }
  }
  if (expected.items)
    assertSchemaCompatible(expected.items, actual.items, `${context}[]`);
  if (expected.oneOf) {
    const expectedTypes = expected.oneOf.flatMap((schema) =>
      Array.isArray(schema.type) ? schema.type : [schema.type],
    );
    const actualTypes = new Set(
      Array.isArray(actual.type) ? actual.type : [actual.type],
    );
    assert.ok(
      [...actualTypes].every((type) => expectedTypes.includes(type)),
      `${context} union type drift`,
    );
    for (const branch of expected.oneOf.filter(
      (schema) => schema.type !== 'null',
    ))
      assertSchemaCompatible(
        { ...branch, type: undefined },
        { ...actual, type: undefined },
        `${context} union branch`,
      );
  }
}

const parityFixture = {
  components: {
    schemas: { Receipt: { type: 'object', required: ['id'] } },
  },
};
assert.throws(
  () =>
    assertSchemaCompatible(
      canonicalSchema(parityFixture, {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      }),
      canonicalSchema(parityFixture, {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'number' } },
      }),
      'fixture',
    ),
  /fixture\.id response type drift/,
  'schema parity check must detect field-level drift',
);

const expectedOperations = operations(contract);
const actualOperations = operations(runtime);
assert.equal(
  actualOperations.length,
  20,
  'supplier runtime must expose exactly 20 routes',
);
assert.equal(
  expectedOperations.length,
  20,
  'frozen supplier contract must expose 20 routes',
);

const actualById = new Map(
  actualOperations.map((entry) => [entry.operation.operationId, entry]),
);
for (const expected of expectedOperations) {
  const actual = actualById.get(expected.operation.operationId);
  assert.ok(
    actual,
    `missing runtime operation ${expected.operation.operationId}`,
  );
  assert.equal(
    actual.path,
    expected.path,
    `${expected.operation.operationId} path drift`,
  );
  assert.equal(
    actual.method,
    expected.method,
    `${expected.operation.operationId} method drift`,
  );
  for (const extension of ['x-permission', 'x-csrf', 'x-audit'])
    assert.deepEqual(
      actual.operation[extension],
      expected.operation[extension],
      `${expected.operation.operationId} ${extension} drift`,
    );
  assert.deepEqual(
    [...(actual.operation['x-additional-permissions'] ?? [])].sort(),
    [...(expected.operation['x-additional-permissions'] ?? [])].sort(),
    `${expected.operation.operationId} additional permission drift`,
  );
  assert.deepEqual(
    Object.keys(actual.operation.responses ?? {}).sort(),
    Object.keys(expected.operation.responses ?? {}).sort(),
    `${expected.operation.operationId} response-status drift`,
  );
  for (const [status, expectedResponse] of Object.entries(
    expected.operation.responses,
  )) {
    const actualResponse = actual.operation.responses[status];
    const expectedResolved = responseSchema(contract, expectedResponse);
    const actualResolved = responseSchema(runtime, actualResponse);
    if (expectedResolved.name === 'Error') {
      const expectedError = contract.components.schemas.Error;
      const actualError = runtime.components.schemas[actualResolved.name];
      assert.ok(
        actualError,
        `${expected.operation.operationId} ${status} error schema missing`,
      );
      assert.deepEqual(
        [...(actualError.required ?? [])].sort(),
        [...expectedError.required].sort(),
        `${expected.operation.operationId} ${status} error required fields drift`,
      );
      assert.deepEqual(
        Object.keys(actualError.properties ?? {}).sort(),
        Object.keys(expectedError.properties).sort(),
        `${expected.operation.operationId} ${status} error fields drift`,
      );
      for (const key of Object.keys(expectedError.properties))
        assert.deepEqual(
          actualError.properties[key],
          expectedError.properties[key],
          `${expected.operation.operationId} ${status} error field ${key} drift`,
        );
    } else {
      assert.equal(
        actualResolved.name,
        expectedResolved.name,
        `${expected.operation.operationId} ${status} response schema drift`,
      );
      assertSchemaCompatible(
        canonicalSchema(contract, expectedResolved.schema),
        canonicalSchema(runtime, actualResolved.schema),
        `${expected.operation.operationId} ${status}`,
      );
    }
  }
  const expectedMutation = ['post', 'patch', 'put', 'delete'].includes(
    expected.method,
  );
  if (expectedMutation) {
    const idempotency = actual.operation.parameters?.some(
      (parameter) => parameter.name === 'Idempotency-Key' && parameter.required,
    );
    assert.equal(
      idempotency,
      true,
      `${expected.operation.operationId} must require Idempotency-Key`,
    );
  }
}

const unlinkResponseSchema =
  runtime.paths['/v1/staff/supplier-offers/{offerId}/match/unlink'].post
    .responses['200'].content['application/json'].schema;
assert.equal(refName(unlinkResponseSchema), 'OfferUnlinkMutationReceipt');
const unlinkSchema = runtime.components.schemas.OfferUnlinkMutationReceipt;
assert.ok(unlinkSchema, 'unlink receipt must have its own generated schema');
assert.deepEqual(unlinkSchema.required, ['data', 'meta']);
const unlinkDataSchema =
  runtime.components.schemas[refName(unlinkSchema.properties.data)];
assert.deepEqual(unlinkDataSchema.required, ['id', 'version']);
assert.deepEqual(Object.keys(unlinkDataSchema.properties).sort(), [
  'id',
  'version',
]);
assert.equal(unlinkDataSchema.properties.purchaseCost, undefined);
assert.equal(
  refName(
    contract.paths['/v1/staff/supplier-offers/{offerId}/match/unlink'].post
      .responses['200'],
  ),
  'OfferUnlinkMutation',
);
assert.equal(
  refName(
    contract.paths['/v1/staff/supplier-offers/{offerId}'].get.responses['200'],
  ),
  'Offer',
  'full private offer remains on its separate read operation',
);

console.log(
  'PASS supplier OpenAPI route inventory, permission policy, idempotency headers, and unlink receipt parity (20 operations).',
);
