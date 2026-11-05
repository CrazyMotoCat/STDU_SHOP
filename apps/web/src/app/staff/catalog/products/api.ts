import type { components } from '@stdu/catalog-client/schema';

type Schemas = components['schemas'];
export type Product = Schemas['StaffCatalogProduct'];
export type Detail = Schemas['StaffCatalogProductDetail'];
export type Category = Schemas['CatalogCategory'];
export type Brand = Schemas['CatalogBrand'];
export type Definition = Schemas['CatalogAttributeDefinition'];
export type Revision = Schemas['CatalogProductRevision'];
export type PermissionSet = {
  permissions: string[];
  passwordChangeRequired: boolean;
};
export type Page<T> = { data: T[]; meta: { nextCursor: string | null } };

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
export const catalog = '/v1/staff/catalog';
export const auth = '/v1/staff/auth';

export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = apiBase.startsWith('/')
    ? new URL(apiBase.replace(/\/$/, '') + path, window.location.origin)
    : new URL(path, apiBase);
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.code === 'string' ? body.code : '';
    const fields = Array.isArray(body?.fields)
      ? body.fields
          .map((field: { field?: string }) => field.field)
          .filter(Boolean)
          .join(', ')
      : '';
    const message =
      response.status === 403
        ? 'Нет доступа к операции.'
        : response.status === 409
          ? 'Конфликт данных или состояния. Сверьте данные перед повтором.'
          : response.status === 400
            ? 'Проверьте значения полей.'
            : response.status === 401
              ? 'Войдите в систему или повторите вход.'
              : 'Сервер не выполнил запрос.';
    throw new RequestError(
      response.status,
      [`HTTP ${response.status}. ${message}`, code, fields]
        .filter(Boolean)
        .join(' '),
    );
  }
  return body as T;
}

export async function mutate<T>(
  path: string,
  method: 'POST' | 'PATCH',
  data: unknown,
) {
  const {
    data: { token },
  } = await request<{ data: { token: string } }>(auth + '/csrf');
  return request<{ data: T }>(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify(data),
  });
}

export async function readAll<T>(path: string, signal?: AbortSignal) {
  const data: T[] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const result: Page<T> = await request(
      path + (path.includes('?') ? '&' : '?') + params,
      { signal },
    );
    data.push(...result.data);
    cursor = result.meta.nextCursor;
  } while (cursor);
  return data;
}
