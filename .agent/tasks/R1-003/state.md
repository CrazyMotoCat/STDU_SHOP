# R1-003

TASK: R1-003
STATUS: IMPLEMENTED_LOCAL_CHECKS_PASS_CI_PENDING
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: A2 — implementation complete; independent review findings resolved; hosted CI pending
UPDATED_AT: 2026-10-23
BRANCH: codex/r1-003-graphite-petrol-ui
BASELINE_MAIN: eb9065782b17ba4a8a74201dcc5d615aa5575793
LAST_SAFE_COMMIT: eb9065782b17ba4a8a74201dcc5d615aa5575793

## FROZEN TASK CONTRACT

- Requirements: CAT-01; decisions #28–34; R1 UI NFRs; backlog item R1-003; the owner-provided R1-003 task prompt.
- Palette: Graphite `#172838`, Petrol `#177A83`, Deep Navy `#0E1B2C`, Dark Petrol `#0F2D2D`, Soft Petrol `#E6F1F2`, Background `#F7F8FA`, Silver `#E4EEF0`, White `#FFFFFF`.
- Deliver reusable semantic CSS tokens, typed accessible UI primitives, a two-row responsive header with keyboard/touch mega-menu, footer, public/category/service/staff layout shells, and a Russian homepage with three equal directions.
- Use an original SVG technical switchgear illustration; do not imply it is a real photographed installation.
- Since catalog, inquiry, and file-upload backend flows are outside this task, show these affordances as clearly unavailable. No false success behavior and no fictional business routes, contacts, prices, certifications, partners, clients, inventory, or case studies.
- Preserve frozen R1-002 1.0.0, decisions #1–108, auth/RBAC/API, and all server/infrastructure behavior. No staff login or domain pages.
- Responsive targets: 375, 768, 1280, 1440 px. Target WCAG 2.2 AA; test semantic names, keyboard/focus/ARIA, reduced motion, and horizontal overflow.
- Verification screenshots: `artifacts/verification/R1-003/home-{desktop,tablet,mobile}.png`.

## IMPLEMENTED

- Added semantic palette/type/spacing/layout tokens, typed UI primitives, future layout shells, responsive two-row header with mega-menu, footer, and an original accessible SVG switchgear illustration.
- Replaced the temporary homepage with a Russian split-screen presentation and three equal service directions. Search, upload, and quote controls remain clearly unavailable; no fake routes or success behavior.
- Added a bounded Playwright production-UI smoke and Vitest SSR checks; the smoke saves desktop/tablet/mobile screenshots under `artifacts/verification/R1-003/`.
- Fixed independent review findings: skip navigation now focuses the `<main>` target with a visible focus ring; repeated `EmptyState` instances use unique React IDs.
- No domain routes, schema, migrations, RBAC, API/auth behavior, or approved decisions were changed.

## LOCAL VERIFICATION

- `pnpm lint` — PASS.
- `pnpm format:check` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS: 39 Vitest passed, 27 skipped; 5 pytest passed.
- `pnpm contract:check` — PASS; frozen/Nest OpenAPI semantic equality (23 operations) and generated client reproducibility.
- `pnpm contract:test` — PASS: 7 passed.
- `pnpm build` — PASS.
- `pnpm ui:smoke` — PASS: skip-link focus, menu keyboard/mouse/touch, ARIA, contrast, disabled future actions, reduced motion, overflow at 375/768/1280/1440; screenshots captured.
- `pnpm smoke` — PASS: service health/readiness, PostgreSQL/Redis, outage checks; volumes preserved.
- `pnpm smoke:host` — PASS x3 sequential on Windows; health/readiness and dependency outage/recovery passed; bounded supervisor verified owned job shutdown and ports were reusable; volumes preserved.
- Independent read-only frontend/UX/accessibility review — no HIGH; one MEDIUM and one LOW resolved; reran affected checks.

## DELIVERY PENDING

- Branch: `codex/r1-003-graphite-petrol-ui` from baseline main `eb9065782b17ba4a8a74201dcc5d615aa5575793`.
- CI, PR merge, and post-integration main SHA are pending.

## NON-GOALS

- No catalog/API, inquiry submission, file upload, staff auth, business forms, domain pages, pricing, inventory, order, manufacturing, CMS, schema, migrations, ADR, or changes to decisions #1–108.
- No production deployment or external paid service.
