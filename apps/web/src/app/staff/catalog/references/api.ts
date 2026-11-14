export const auth = '/v1/staff/auth';
export const catalog = '/v1/staff/catalog';

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';
const statusMessages: Record<number, string> = {
  400: 'Проверьте значения полей.',
  401: 'Войдите в систему повторно.',
  403: 'Доступ к операции запрещён.',
  409: 'Конфликт данных или состояния. Сверьте актуальную запись перед повтором.',
};

export class StaffRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = base.startsWith('/')
    ? new URL(base.replace(/\/$/, '') + path, window.location.origin)
    : new URL(path, base);
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const fields = Array.isArray(body?.fields)
      ? body.fields
          .map((item: { field: string; code: string }) =>
            [item.field, item.code].join(' · '),
          )
          .join(', ')
      : '';
    const message = typeof body?.message === 'string' ? body.message : '';
    const code = typeof body?.code === 'string' ? body.code : '';
    throw new StaffRequestError(
      response.status,
      [
        `HTTP ${response.status}. ${statusMessages[response.status] ?? 'Сервер не выполнил запрос.'}`,
        message,
        code,
        fields,
      ]
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

export const pageSize = 50;

export function readPage<T>(
  path: string,
  cursor: string | null,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ limit: String(pageSize) });
  if (cursor) params.set('cursor', cursor);
  return request<{ data: T[]; meta: { nextCursor: string | null } }>(
    path + (path.includes('?') ? '&' : '?') + params,
    { signal },
  );
}
