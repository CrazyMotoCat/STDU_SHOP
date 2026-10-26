# Public indexing

SEO configuration is read by the web production build and dynamic catalog
rendering. Supply the same three server environment variables to the build
(`pnpm --filter @stdu/web build`) and the web runtime:

- `APP_ENV=production`
- `PUBLIC_WEB_ORIGIN`: the explicitly configured public HTTPS origin, without a
  path, credentials, query, or fragment. Local names and IP addresses are rejected.
- `PUBLIC_SITE_INDEXING_ENABLED=true`

Rebuild web after changing these values. Do not reuse an indexing-enabled build
for a preview environment. Missing, invalid, or disabled configuration produces
`Disallow: /`, an empty sitemap, and noindex metadata.

The sitemap contains only /, /catalog, /panels, and /engineering. Published catalog
detail pages inherit the catalog indexing policy but are not enumerated until a
reliable public API export exists. Staff pages inherit noindex; /request-quote
retains its own noindex even with preview enabled. Both paths are excluded in
robots.txt. Robots directives do not provide authorization.
