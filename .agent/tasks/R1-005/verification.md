# R1-005 — public catalog frontend verification

**Status:** COMPLETE — merged to `main`.
**Delivery mode:** AUTO_MERGE.
**Baseline:** `e0da526fa411aab99fe7334ab50088941ea4082f`.
**Contract:** R1-004A Catalog Domain FROZEN 1.0.0; OpenAPI/schema unchanged.

## Implemented routes

- `/catalog` — server-rendered public category navigation, search, brand scope, sorting, page size, grid/list/table and product pagination.
- `/catalog/category/[slug]` — direct category children, cursor navigation, breadcrumbs, descendant search without technical filters, and exact-category technical filters.
- `/catalog/product/[slug]` — public identity, summary/description, technical attributes and units, manual accessory/compatible relations, request pricing, neutral media placeholder, and disabled future quote action.

The Next.js server calls only the frozen public category, product-search and product-detail operations. API calls use generated OpenAPI types, `no-store`, and a five-second timeout. Product/file URLs are not invented. Unknown category/product slugs return the Next not-found response with HTTP 404. The search remains a literal substring search as specified.

## Contract constraints and gap

The client sends each technical filter as a repeated `filter` parameter. It always sets the selected `categorySlug` and explicit `includeDescendants=false` when applying filters. A URL with a filter but no exact category or with omitted/true descendants reaches the public API validation response and is shown as an error.

FROZEN public API does not expose filterable AttributeDefinitions or a complete brand list. The UI therefore asks for an attribute code manually and offers brand slugs seen on the loaded product page. Product cards contain no technical attribute values; the table shows only fields present in the card DTO, and the detail route renders the published technical values.

Proposed minimal future contract (requires separate owner approval): one bounded `GET /v1/public/catalog/facets?categorySlug={slug}` response with the active category’s public filterable definitions (`code`, `label`, `valueType`, `unitLabel`, allowed operators) and public brand choices (`name`, `slug`); definitions remain exact-category with no inheritance and no file identifiers. If table mode must show technical values, a separate bounded card-highlight DTO must also be approved. No contract changes were made in R1-005.

## Actual verification

| Command | Result |
| --- | --- |
| `pnpm toolchain:check` | PASS — Node 24.19.0, pnpm 11.25.0, Python 3.14.3, uv 0.13.3 |
| `pnpm db:validate` | PASS |
| `pnpm catalog:contract:check` | PASS — FROZEN 1.0.0 and reproducible OpenAPI |
| `pnpm catalog:contract:test` | PASS — 47/47 |
| `pnpm catalog:client:check` | PASS — generated TypeScript declarations reproducible |
| `pnpm catalog:route:check` | PASS — all 31 live Nest operations match frozen security/route inventory |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | PASS |
| `pnpm test` | PASS — Vitest 44 passed, 39 skipped; ingestion pytest 5 passed |
| `pnpm catalog:runtime:check` | PASS — isolated PostgreSQL/Redis migration, fixtures, backup/restore, permission initializer and 12 CATB runtime tests; no working DB or persistent volume touched |
| `pnpm build` | PASS — API, web, staff client and ingestion package; Next emitted all three dynamic catalog routes |
| `pnpm catalog:ui:smoke` | PASS — isolated synthetic API adapter, 15 public product calls, browser interactions, true 404, responsive overflow and owned port release |
| `git diff --check` | PASS |
| `docker build --tag stdu-r1-005-web-build-check --file apps/web/Dockerfile .` | PASS after adding `packages/catalog-client` to the Docker build stage |
| `docker build --tag stdu-r1-005-api-build-check --file apps/api/Dockerfile .` | PASS after adding the catalog-client workspace manifest to the API install stage |
| GitHub Actions `40060531134` | PASS — full R1 foundation pipeline for merge candidate `ce8a0cd8b0cc328c48e68025b85c3d66e00613ec`, including contract/runtime checks, build, both UI smokes, Compose, three host smokes and cleanup |

## Hosted CI failure and correction

The first exact-head GitHub Actions run (`40059663787`, head `454328c1cdc7a8e4fb4fd000bc2e01d757427b3c`) passed the new catalog browser acceptance, then failed in the existing five-service Compose build. Its web Dockerfile had copied `apps/web/package.json` but not the new local `@stdu/catalog-client` workspace package, so the container build could not resolve `@stdu/catalog-client/schema`. The fix copies the catalog-client manifest before frozen pnpm install and its source before the web build. This run was superseded after the fix.

The next exact-head run (`40060077086`, head `4effba8f773cd5c4c97b1fe501b634b422a8fd82`) confirmed the web image now typechecks, but failed in the parallel API image's `pnpm --filter @stdu/api deploy --prod --legacy /runtime`: deploy validates workspace references and `apps/api/Dockerfile` had not copied the catalog-client manifest. Added its manifest to the API install stage. Both web and API images built locally, then full run `40060531134` passed with both fixes.

The final local rerun was performed in the task worktree on 2026-10-24 after extracting the persistent `/catalog` shell into `apps/web/src/app/catalog/layout.tsx`. The browser smoke's graceful shutdown exceeded its 10-second grace period and then forced termination of the task-owned Next job boundary within the configured 5-second limit; it verified the owned port was released. No process was selected by name or port, and no external service or volume was stopped or deleted. `pnpm` printed its existing engine warning because this shell reported Node v24.22.1 while the package declares 24.19.0; `pnpm toolchain:check` itself passed and reported the pinned Node 24.19.0 toolchain.

The Playwright adapter is test-only and synthetic. Real public API request/response and PostgreSQL behavior were checked independently by `pnpm catalog:runtime:check`; no catalog permissions were granted in the working database.

## Screenshots

Saved under `artifacts/verification/R1-005/`:

- `catalog-desktop.png`, `catalog-mobile-375.png`
- `category-table-1440.png`, `category-mobile-375.png`
- `product-desktop.png`, `product-mobile-375.png`

## Integration boundary

PR #10 remains Draft and untouched. After it merges, connect the header’s equipment menu to `/catalog`, enable the global catalog search, and route the homepage equipment/search entry to the new catalog. Those shared-home/header edits are intentionally outside R1-005.

## Delivery and post-merge status

PR [#11](https://github.com/CrazyMotoCat/STDU_SHOP/pull/11) was squash-merged. Final PR head: `fb0c721b805414c6474311e1a23adeeedacf4790`. Final `main` merge SHA: `fbda42393b2ee61e49b0af74c4c772484f1f00af`.

The successful full CI run `40060531134` tested merge candidate `ce8a0cd8b0cc328c48e68025b85c3d66e00613ec`. The GitHub commit API confirmed its tree SHA equals the merged commit tree (`a6e9ce9236e51d617f80e7cd5f6af70c2a3d0f5e`). A post-merge push run (`40061431022`) was in progress when checked; it was not awaited per the owner's instruction to treat unchanged code as green. No code changed after the passing candidate CI.

PR #10 remains open as Draft and untouched. No production migration, deployment, permission grant, persistent data deletion or volume removal was performed.
