import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { root, requireFreePort } from './lib.mjs';
import { withProcesses } from './process-lifecycle.mjs';
import {
  demoProducts,
  demoCards,
  demoCategories,
  prepareSyntheticDemoMedia,
} from './iek-demo-fixture.mjs';

// Loopback-only fixture adapter: no DB, permissions, publication or external API.
const fixture = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  const envelope = (data, meta) => {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(
      JSON.stringify({
        data,
        meta: { requestId: '00000000-0000-4000-8000-00000000001b', ...meta },
      }),
    );
  };
  if (url.pathname === '/v1/public/catalog/categories') {
    envelope(url.searchParams.has('parentSlug') ? [] : demoCategories, {
      pageSize: 24,
      nextCursor: null,
    });
    return;
  }
  if (url.pathname === '/v1/public/catalog/products') {
    const query = url.searchParams.get('q')?.toLowerCase();
    const rows = demoCards.filter(
      (product) =>
        (!url.searchParams.has('categorySlug') ||
          product.category.slug === url.searchParams.get('categorySlug')) &&
        (!url.searchParams.has('brandSlug') ||
          product.brand.slug === url.searchParams.get('brandSlug')) &&
        (!query ||
          [product.displayName, product.originalPartNumber].some((value) =>
            value.toLowerCase().includes(query),
          )),
    );
    envelope(rows, {
      page: 1,
      pageSize: 24,
      total: rows.length,
      totalPages: 1,
    });
    return;
  }
  const product = demoProducts.find(
    (item) => url.pathname === `/v1/public/catalog/products/${item.slug}`,
  );
  if (product) {
    envelope(product, {});
    return;
  }
  response.writeHead(404).end();
});
async function listen(server) {
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}
async function main() {
  const mode = process.argv.includes('--synthetic')
    ? 'synthetic'
    : 'owner-local';
  if (mode === 'synthetic') await prepareSyntheticDemoMedia();
  const apiPort = await listen(fixture);
  const probe = createServer();
  const port = await listen(probe);
  await new Promise((accept) => probe.close(accept));
  await requireFreePort(port);
  const web = resolve(root, 'apps/web');
  const nextCli = createRequire(resolve(web, 'package.json')).resolve(
    'next/dist/bin/next',
  );
  try {
    await withProcesses(
      [
        {
          name: 'vis-cat-01b-preview',
          command: process.execPath,
          args: [
            nextCli,
            'start',
            '--hostname',
            '127.0.0.1',
            '--port',
            String(port),
          ],
          cwd: web,
          env: {
            APP_ENV: 'test',
            CATALOG_DEMO_MEDIA_MODE: mode,
            API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
            NEXT_TELEMETRY_DISABLED: '1',
          },
          quiet: true,
        },
      ],
      async (signal) => {
        console.log(
          `LOCAL DEMO ONLY (${mode}): http://127.0.0.1:${port}/catalog`,
        );
        console.log(
          'UI fixtures only; no product has been published in a database. Ctrl+C stops owned resources.',
        );
        await new Promise((accept) =>
          signal.addEventListener('abort', accept, { once: true }),
        );
      },
    );
  } finally {
    await new Promise((accept) => fixture.close(accept));
  }
}
main().catch((error) => {
  if (![130, 143].includes(error.exitCode)) {
    console.error(error);
    process.exitCode = 1;
  }
});
