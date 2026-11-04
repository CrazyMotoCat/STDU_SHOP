# VIS-CAT-01B — public test-site enablement

## Owner statement and scope

`PUBLICATION_RIGHTS: OWNER_CONFIRMED` — on 2026-11-03 the project owner stated that the necessary manufacturer permissions for publishing the four supplied WebP photographs were received and explicitly authorized their inclusion in the public repository and public test site. The agent has **not independently reviewed license documents**. Historical `NOT_CONFIRMED` fields in the original archive manifest describe its earlier import state; the new `publicationRights` owner statement records the superseding decision.

Approved identities: IEK + IEK + `AR-M06N-1-C006`; IEK + IEK + `AR-B06S-1N-C06C030`. Each retains20 attributes from manifest v2.1, exact source tiers, units and values. M06N400V; B06S230V,30mA,AC; both6kA and “Цена по запросу”. B06S230V/6kA remain distributor_same_sku, not manufacturer-tier. No price/stock/warranty is invented.

## Four public static assets

Path prefix: `apps/web/public/images/catalog/demo/iek-armat/`.

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `ar-m06n-1-c006-main.webp`      | `565c9b37e5358821d0f245c83fb8ad41b03055df4640eeefc11fef217355f28c` |
| `ar-m06n-1-c006-group.webp`     | `146104a993210bde7aa2c5cdf68c9918b5e2b4d97402976813792aa73010f88d` |
| `ar-b06s-1n-c06c030-main.webp`  | `6bd031922efa70d876d31b89825c7af3b3ca454348b944d7feb456b0fcfc447d` |
| `ar-b06s-1n-c06c030-group.webp` | `4a46a364d205ec29bee0eeb9978fc8230dff5413168ab5b5263658379a879dca` |

`python scripts/prepare-iek-demo.py` verifies repository bytes/lengths against the manifest. An optional owner ZIP argument restores the same four pinned files. No PNGs, arbitrary URLs, generic file download endpoint, StoragePort or `.local` runtime dependency. Ordinary Next static serving/cache headers apply; the image allowlist may also display these approved photographs for a real API product with the exact identity. This does not activate fixture data or mutate a product. Main/group files retain their original proportions and pixels; group is not split.

## Test catalog: option B

No safe Staff principal/grants or target test DB was supplied. Existing reference/product publication endpoints are permission-gated and the repository test bootstrap uses privileged identity/role fixtures. No grants, directSQL, publication/audit bypass or DB seed is added. Option B supplies **server-side V1-shaped fixture data directly in Next**, not through a separate local fixture HTTP service.

Both runtime settings must match exactly:

```text
APP_ENV=test
CATALOG_TEST_SITE_ENABLED=true
```

`NODE_ENV=production` is compatible with a production build on the dedicated test site; NODE_ENV alone never authorizes fixtures. Default/missing/invalid flags and APP_ENV=production retain normal API calls, errors and404s, even for these two slugs. No silent API-failure fallback and no extra fields in FROZEN V1. The catalog displays an explicit server-fixture/noDB-publication notice. These are not published database records.

Supported fixture operations: two leaf categories, literal case-insensitive search across names/brand/manufacturer/SKU/modification, supported display sorts and pagination, details, grid/list/table. Advanced technical filters are explicitly unavailable in test-site UI and return validation if requested; no claim that the production filter engine has been reproduced. Twenty attributes remain on each detail page.

## Local preparation checks

```powershell
pnpm install --frozen-lockfile
pnpm --filter @stdu/web build
python scripts/prepare-iek-demo.py
node scripts/iek-demo-preview.mjs
```

The preview starts only an owned loopback Next production server on an ephemeral port, with the two explicit test flags. No API fixture server, DB or Docker is needed for the catalog. Ctrl+C stops owned web. This preview is **not** evidence of internet deployment.

`pnpm catalog:ui:smoke` verifies normal API behavior and the explicitly configured production Next test build with an unreachable API URL: both SKUs/categories/search/detail/gallery, all four real static image hashes/Content-Type/cache headers,320/375/768/1024/1440, no overflow/pageerrors; production/default modes retain the API error instead of fixtures. Local test-build screenshots are under `artifacts/verification/VIS-CAT-01B/test-site-build/`; they must not be labelled screenshots of a published external site.

## Deployment preparation — DO NOT EXECUTE without separate authorization

Merge and actual deployment are **not authorized** by this task. Owner clarified that no external site exists yet; it will be considered after the production version is ready. External deployment/acceptance is NOT_PROVISIONED. Do not invent a domain or provision infrastructure. For a future deployment phase, obtain the exact HTTPS target, deployment platform/project, approved environment and separate authorization. Do not modify live SEO flags or production configuration.

For an existing, separately approved test Compose stack only, the prepared overlay `infra/compose/compose.catalog-test.yaml` changes only the web service's two test flags. Base Compose and Dockerfile are unchanged; the existing Dockerfile copies public assets into the runtime image. After authorization, an operator can use the actual test project's values:

```text
docker compose --project-directory . --project-name <existing-test-project> --env-file <approved-test-env> -f infra/compose/compose.yaml -f infra/compose/compose.catalog-test.yaml build web
docker compose --project-directory . --project-name <existing-test-project> --env-file <approved-test-env> -f infra/compose/compose.yaml -f infra/compose/compose.catalog-test.yaml up -d --no-deps web
```

Build the exact owner-approved commit. Retain the existing reverse proxy/TLS and test URL; keep API/PostgreSQL/Redis/ingestion/volumes untouched. Existing API readiness health checks remain unchanged. Do not apply this overlay to a production project. Roll back by returning the test web to its previously approved image/config, not deleting data.

After separately authorized deployment, verify the **external** `<owner-test-origin>/catalog`, both category/detail routes, header/catalog searches, all four `/images/catalog/demo/iek-armat/*.webp`, main/group switch, grid/list/table, all5widths and no overflow, visible fixture notice,20attrs, noindex/default-prod fixture denial; capture external screenshots and record deployed SHA. That external acceptance is NOT_PERFORMED until deployment is authorized and carried out.

REVIEW_REQUIRED / existing Draft PR39 / NO_MERGE / NO_DEPLOY. Q0-04 inherited intact. No VIS-CAT-02B, Product Media pipeline, frozen/API/RBAC/migration or other PR changes.
