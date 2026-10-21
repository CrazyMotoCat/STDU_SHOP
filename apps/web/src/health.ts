export function readinessHandler(
  baseUrl: () => string | undefined,
  request: typeof fetch = fetch,
) {
  return async (): Promise<Response> => {
    try {
      const base = baseUrl();
      if (!base) throw new Error('API_INTERNAL_URL is required');
      const response = await request(new URL('/health/ready', base), {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200) throw new Error('Dependency not ready');
      return Response.json({ status: 'ready' });
    } catch {
      return Response.json({ status: 'not_ready' }, { status: 503 });
    }
  };
}
