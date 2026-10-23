import { readFile } from 'node:fs/promises';

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function resolveSchema(schema, components, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').at(-1);
    if (seen.has(name)) return { $ref: schema.$ref };
    const target = components?.schemas?.[name];
    if (!target) throw new Error(`Unresolved schema reference ${schema.$ref}`);
    const next = new Set(seen);
    next.add(name);
    return resolveSchema(target, components, next);
  }
  const result = {};
  for (const key of [
    'type',
    'format',
    'nullable',
    'readOnly',
    'writeOnly',
    'enum',
    'pattern',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'default',
    'additionalProperties',
    'required',
    'properties',
    'items',
    'allOf',
    'oneOf',
    'anyOf',
  ]) {
    if (schema[key] === undefined) continue;
    if (key === 'enum')
      result[key] = [...schema[key]].sort((a, b) =>
        String(a).localeCompare(String(b)),
      );
    else if (key === 'required') result[key] = [...schema[key]].sort();
    else if (key === 'properties') {
      result[key] = Object.fromEntries(
        Object.entries(schema[key])
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, child]) => [
            name,
            resolveSchema(child, components, seen),
          ]),
      );
    } else if (key === 'items')
      result[key] = resolveSchema(schema[key], components, seen);
    else if (['allOf', 'oneOf', 'anyOf'].includes(key))
      result[key] = schema[key].map((child) =>
        resolveSchema(child, components, seen),
      );
    else result[key] = schema[key];
  }
  return result;
}

function security(value) {
  return (value ?? []).map((entry) =>
    Object.fromEntries(
      Object.entries(entry)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, scopes]) => [name, [...scopes].sort()]),
    ),
  );
}

function parameter(value, components) {
  return {
    name: value.name,
    in: value.in,
    ...(value.required === true ? { required: true } : {}),
    ...(value.style !== undefined ? { style: value.style } : {}),
    ...(value.explode !== undefined ? { explode: value.explode } : {}),
    ...(value.allowEmptyValue !== undefined
      ? { allowEmptyValue: value.allowEmptyValue }
      : {}),
    ...(value.schema
      ? { schema: resolveSchema(value.schema, components) }
      : {}),
    ...(value.content ? { content: value.content } : {}),
  };
}

function response(value, components) {
  return {
    ...(value.content
      ? {
          content: Object.fromEntries(
            Object.entries(value.content)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([contentType, media]) => [
                contentType,
                resolveSchema(media.schema, components),
              ]),
          ),
        }
      : {}),
    ...(value.headers
      ? {
          headers: Object.fromEntries(
            Object.entries(value.headers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, header]) => [
                name,
                resolveSchema(header.schema ?? {}, components),
              ]),
          ),
        }
      : {}),
  };
}

function operation(value, components) {
  const extensions = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.startsWith('x-'))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    operationId: value.operationId,
    parameters: (value.parameters ?? [])
      .map((item) => parameter(item, components))
      .sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`)),
    ...(value.requestBody
      ? {
          requestBody: {
            required: value.requestBody.required ?? false,
            content: Object.fromEntries(
              Object.entries(value.requestBody.content ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([contentType, media]) => [
                  contentType,
                  resolveSchema(media.schema, components),
                ]),
            ),
          },
        }
      : {}),
    responses: Object.fromEntries(
      Object.entries(value.responses ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([status, item]) => [status, response(item, components)]),
    ),
    security: security(value.security),
    extensions,
  };
}

function pathOperations(document) {
  const paths = {};
  for (const [path, pathItem] of Object.entries(document.paths ?? {}).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    const methods = Object.entries(pathItem).filter(
      ([, value]) => value && typeof value === 'object' && 'responses' in value,
    );
    if (methods.length)
      paths[path] = Object.fromEntries(
        methods
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([method, value]) => [
            method,
            operation(value, document.components),
          ]),
      );
  }
  return paths;
}

function schemas(document) {
  return Object.fromEntries(
    Object.entries(document.components?.schemas ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, schema]) => [
        name,
        resolveSchema(schema, document.components),
      ]),
  );
}

function securitySchemes(document) {
  return Object.fromEntries(
    Object.entries(document.components?.securitySchemes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, schema]) => [
        name,
        Object.fromEntries(
          Object.entries(schema)
            .filter(([key]) => key !== 'description')
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
  );
}

export function semanticProjection(document) {
  const rootExtensions = Object.fromEntries(
    Object.entries(document)
      .filter(([key]) => key.startsWith('x-'))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    openapi: document.openapi,
    info: { title: document.info?.title, version: document.info?.version },
    servers: (document.servers ?? []).map(({ url }) => url),
    security: security(document.security),
    securitySchemes: securitySchemes(document),
    schemas: schemas(document),
    paths: pathOperations(document),
    rootExtensions,
  };
}

function collectDifferences(expected, actual, at = '$', out = []) {
  if (out.length >= 30) return out;
  if (Object.is(expected, actual)) return out;
  if (
    !expected ||
    !actual ||
    typeof expected !== 'object' ||
    typeof actual !== 'object' ||
    Array.isArray(expected) !== Array.isArray(actual)
  ) {
    out.push(
      `${at}: expected ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
    return out;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of [...keys].sort()) {
    if (!(key in expected))
      out.push(`${at}.${key}: unexpected value ${JSON.stringify(actual[key])}`);
    else if (!(key in actual))
      out.push(
        `${at}.${key}: missing; expected ${JSON.stringify(expected[key])}`,
      );
    else collectDifferences(expected[key], actual[key], `${at}.${key}`, out);
    if (out.length >= 30) break;
  }
  return out;
}

export function compareOpenApi(expected, actual) {
  const left = semanticProjection(expected);
  const right = semanticProjection(actual);
  const differences = collectDifferences(left, right);
  return { equal: differences.length === 0, differences };
}
