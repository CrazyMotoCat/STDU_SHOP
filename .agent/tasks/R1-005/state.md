# R1-005 — public catalog frontend

TASK: R1-005
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE_WITH_CHECKPOINT
PHASE: implementation and final local verification complete; ready for commit/PR
UPDATED_AT: 2026-10-24
BRANCH: codex/r1-005-public-catalog
BASELINE_MAIN: e0da526fa411aab99fe7334ab50088941ea4082f
CONTRACTS_FROZEN: R1-004A Catalog Domain 1.0.0; no OpenAPI/schema changes authorized
PARALLEL_WRITES: none; protect PR #10 branch/worktree and home page/shared styles/showcase files
RESUME_SAFE: YES
REPOSITORY_STATE: DIRTY_EXPECTED
LAST_SAFE_COMMIT: e0da526fa411aab99fe7334ab50088941ea4082f
NEXT_ACTION: stage explicit R1-005 paths; inspect staged diff; commit/push branch; open R1-005 PR; run exact-HEAD GitHub CI
DO_NOT_REPEAT: frozen R1-004 checker/runtime suite and browser smoke unless code changes invalidate them

## Scope

Implement public SSR catalog, category and product routes using only the three frozen R1-004 public API operations and generated TypeScript types. Support URL-backed search, category and brand scope, sorting, pagination and grid/list/table views. Technical filters must send `categorySlug` and explicit `includeDescendants=false`; dynamic AttributeDefinition facets are blocked by the absence of a public definitions endpoint, so do not infer definitions from staff APIs or invent them. Use `Цена по запросу`; never expose file URLs or fabricate product imagery. No cart, checkout, order, quote submission, backend/API/schema, home page or shared global-style changes.

## Verification plan

- Format changed files; run web typecheck and focused catalog tests.
- Verify data fetching against the actual public Nest API on isolated test data; do not seed or grant permissions in the working database.
- Run desktop/mobile browser acceptance and save screenshots for catalog/category/product.
- Run catalog contract checks, full local quality gate and final GitHub CI for the implementation PR.

## Completed implementation

- Added SSR routes `/catalog`, `/catalog/category/[slug]`, and `/catalog/product/[slug]` using generated R1-004 client types and only the three frozen public API operations.
- Added URL-backed search, brand slug, category navigation, sort, page/page size, grid/list/table views, cursor pagination for direct category children, product details, attributes, and manual accessory/compatibility links.
- Technical filters keep repeated values, send exact `categorySlug`, and explicitly set `includeDescendants=false`. An omitted/invalid scope is allowed to reach the public API and renders its validation error rather than being silently rewritten.
- Added neutral unavailable/loading image states, a bounded 5-second public API fetch timeout, retry boundary, empty/error panels, metadata and true HTTP 404 for unknown category/product slugs.
- Added isolated fixture-backed Playwright smoke plus desktop/mobile screenshots; fixtures are synthetic and not commercial product data.
- Added no backend, migration, API/OpenAPI, RBAC, permission, home page, shared global CSS, or PR #10 changes.

## Local verification completed

- `pnpm toolchain:check`, `pnpm db:validate`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` — PASS.
- Frozen catalog: OpenAPI reproducibility/check, 47 contract tests, generated client reproducibility, live Nest route inventory — PASS.
- `pnpm catalog:runtime:check` — PASS on task-owned ephemeral PostgreSQL 18.6 and Redis; fresh/populated migrations, preserved R1-002 fixtures, backup/restore, initializer and 12 CATB HTTP/PostgreSQL tests passed. No persistent volume or working database was used.
- Final worktree rerun: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm toolchain:check`, `pnpm db:validate`, `pnpm catalog:contract:check`, `pnpm catalog:contract:test`, `pnpm catalog:client:check`, `pnpm catalog:route:check`, `pnpm catalog:ui:smoke`, and `git diff --check` — PASS.
- `pnpm catalog:ui:smoke` — PASS with an isolated API fixture adapter; search, brand, empty state, category BFS/path, invalid technical scope, explicit `false`, repeated filter, view preservation, product details/relations, 404, desktop/mobile overflow and screenshot capture passed. Shutdown exceeded its 10-second grace period and used the 5-second bounded forced stop on the task-owned Next job boundary only; the owned port was confirmed released.
- Full Vitest: 44 passed, 39 skipped; ingestion pytest: 5 passed. Contract tests: 47 passed.
- Screenshots: `artifacts/verification/R1-005/` (catalog, category/table, product; desktop/mobile).

## Outstanding

- Final staged-diff review, commit and push.
- Create PR, verify exact-head GitHub Actions and merge only after all required checks and repository rules pass.
- Do not edit or integrate the still-Draft PR #10. Follow-up integration points after its merge: equipment navigation link to `/catalog`, shared header catalog search, and homepage equipment/search links.
- Contract gap for later owner decision: public API has no exact-category filterable AttributeDefinition facets or complete public brand listing; list cards omit technical values. This UI therefore accepts a manually entered attribute code, derives brand suggestions only from the loaded page and shows technical values on detail pages. No FROZEN contract change is included.

## Protected concurrent work

PR #10 is Draft and based on `d6bed64`; its branch changes `apps/web/src/app/page.tsx`, `apps/web/src/app/styles.css`, `apps/web/src/components/site/switchgear-illustration.tsx`, `apps/web/src/components/visual/engineering-motion-showcase.tsx`, `apps/web/src/components/ui/primitives.tsx`, and AGENTS.md. Do not edit those paths. Avoid shared header changes before PR #10 integrates; record any menu/home integration point as follow-up.
