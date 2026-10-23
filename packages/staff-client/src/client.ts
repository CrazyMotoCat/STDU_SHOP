import createClient from 'openapi-fetch';
import type { paths } from './schema.js';

const csrfPath = '/v1/staff/auth/csrf';

export function createStaffClient(
  baseUrl: string,
  fetchImplementation: typeof fetch = fetch,
) {
  let csrfToken: string | null = null;
  let csrfPending: Promise<string> | null = null;

  async function loadCsrf() {
    if (csrfToken) return csrfToken;
    if (!csrfPending) {
      csrfPending = (async () => {
        const endpoint = new URL(
          csrfPath,
          baseUrl || globalThis.location?.origin,
        );
        const response = await fetchImplementation(endpoint, {
          method: 'GET',
          credentials: 'include',
          headers: { accept: 'application/json' },
        });
        if (!response.ok)
          throw new Error(`CSRF challenge failed with HTTP ${response.status}`);
        const result = (await response.json()) as {
          data?: { token?: unknown };
        };
        if (typeof result.data?.token !== 'string')
          throw new Error('CSRF endpoint returned an invalid response.');
        csrfToken = result.data.token;
        return csrfToken;
      })().finally(() => {
        csrfPending = null;
      });
    }
    return csrfPending;
  }

  const authorizedFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const safe = ['GET', 'HEAD', 'OPTIONS'].includes(
      request.method.toUpperCase(),
    );
    if (path !== csrfPath && !safe) {
      const headers = new Headers(request.headers);
      headers.set('X-CSRF-Token', await loadCsrf());
      const response = await fetchImplementation(
        new Request(request, { headers, credentials: 'include' }),
      );
      if (
        response.ok ||
        path === '/v1/staff/auth/login' ||
        path === '/v1/staff/auth/logout' ||
        path === '/v1/staff/auth/me/password'
      )
        csrfToken = null;
      if (response.status === 403) {
        try {
          const body = (await response.clone().json()) as { code?: unknown };
          if (body.code === 'CSRF_INVALID') csrfToken = null;
        } catch {
          /* Keep the original response; the caller owns error handling. */
        }
      }
      return response;
    }
    return fetchImplementation(
      new Request(request, { credentials: 'include' }),
    );
  };

  return createClient<paths>({
    baseUrl,
    credentials: 'include',
    fetch: authorizedFetch,
  });
}
