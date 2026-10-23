# R1-003V-01 — Engineering Motion Showcase

TASK: R1-003V-01
STATUS: PR_OPEN_REQUIRED_CI_PENDING_LOCAL_HOST_SMOKE_BLOCKED
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: PR #9 open; independent reviews passed; full exact-HEAD workflow pending
UPDATED_AT: 2026-10-24
BRANCH: codex/r1-003v-01-engineering-motion
BASELINE_MAIN: ab7f5a25a7d36d2d722e36effb8c9fecb848c88a
LAST_SAFE_COMMIT: 14c1245
WORKTREE_STATUS: clean after PR checkpoint update

## Frozen task contract

- Source requirements: CAT-01; decisions #28–31; backlog item R1-003; approved R1 UI/accessibility requirements; owner task `STDU_SHOP — R1-003V-01: Engineering Motion Showcase`.
- Keep the three homepage directions equal, the existing engineering accent, Graphite & Petrol, and unavailable search/upload/quote actions.
- Add an original static-first engineering SVG showcase with three semantic selectable states: equipment, electrical panel, and engineering system. The art is explicitly illustrative, not a configurator or live system.
- Preserve SSR content, keyboard/touch operation, unique SVG IDs, reduced-motion behavior, no horizontal overflow, text contrast, and the existing business meaning.
- No catalog, API, database/schema, migrations, RBAC, frozen contracts, shared generated client, or business rules are in scope. No production deployment.

## Repository and parallel-work preflight

- Created isolated worktree `C:\Users\mvideo\.codex\worktrees\r1-003v-01\SHOP STDU` on `codex/r1-003v-01-engineering-motion` from fresh `origin/main` `ab7f5a25a7d36d2d722e36effb8c9fecb848c88a`.
- Fresh fetch confirmed `origin/main` remains at the baseline SHA.
- The parallel `codex/r1-004b-catalog-domain` branch changes only its R1-004B task/contract and CI files; no overlap with this task's changed paths. Its worktree was not modified.
- The existing `stdu-shop-r1-001` Compose stack owns host ports 3000 and 3001. It was left running and untouched.

## Implemented

- Added `apps/web/src/components/visual/engineering-motion-showcase.tsx` with original SVG/CSS component, cabinet, and system diagrams; semantic pressed-state buttons; changing explanation; SSR initial state; unique SVG IDs; static reduced-motion presentation.
- Added finite cabinet contour/highlight/impulse motion and hover-safe styling; completed contour dash lengths and adjusted decorative-line reveal to avoid a hide/redraw flash.
- Added contrast-safe figure caption styling and a browser contrast assertion; constrained card hover to hover-capable devices.
- Integrated the showcase below the three equal direction cards while retaining their hierarchy and disabled actions.
- Extended `scripts/ui-smoke.mjs` for task-specific screenshots, SSR, three-state, keyboard/touch, contrast, console-error, reduced-motion, overflow, and mobile performance checks.
- Added optional smoke host-port overrides in the existing isolated Compose/host smoke harness so Compose smoke can run alongside the active project; default ports are unchanged. Compose mode supports an API host-port override. Host API remains bound to required loopback port 3001.
- Added before/after screenshots and three state frames in `artifacts/verification/R1-003V-01/`.
- No new runtime dependency.

## Verification actually run

- `pnpm toolchain:check` — PASS. Direct `pnpm` emits an engine warning because its Node reports v24.22.1 while repository metadata requests v24.19.0; the project toolchain check reports the pinned Node, pnpm, Python, and uv versions available.
- `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:validate` — PASS. Vitest: 39 passed, 27 skipped; pytest: 5 passed, one Starlette/httpx deprecation warning.
- `pnpm contract:check` — PASS: frozen-to-Nest OpenAPI semantic equality for 23 operations; generated TypeScript client reproducible.
- `pnpm contract:test` — PASS: 7/7.
- `pnpm build` — PASS (web, API, and ingestion source distribution).
- `pnpm ui:smoke` with `UI_SMOKE_TASK_ID=R1-003V-01` — PASS: SSR, keyboard/ARIA, touch, contrast, disabled actions, reduced motion, browser console, and 375/768/1280/1440 widths. Mobile cold browser sample at 375px: DOM-ready 72 ms, LCP 80 ms, CLS 0, 137 KiB encoded JS. This is a local smoke sample, not a production-device performance guarantee.
- `pnpm smoke` with `STDU_SMOKE_WEB_PORT=13000`, `STDU_SMOKE_API_PORT=13001`, `STDU_SMOKE_INGESTION_PORT=18000` — PASS: Compose app readiness/liveness, PostgreSQL SELECT 1, Redis PING, dependency outage behavior, no secret leakage; volumes preserved and isolated smoke services stopped.
- `pnpm smoke:host` — BLOCKED before app startup: required host API port 3001 is occupied by `stdu-shop-r1-001-api-1` in the running `stdu-shop-r1-001` stack. The stack was preserved. Host smoke must be rerun when that listener is released or by hosted CI in a clean runner.
- Independent read-only reviews originally found two contour-length/motion-polish points and one caption contrast issue. Those were corrected and both frontend and UX/accessibility follow-up reviews passed read-only.
- Browser artifacts: before/after desktop, tablet, mobile; state 01/02/03. No video was recorded; the requested interaction frame sequence is present.

## Non-goals

- No products, catalog API, inquiries, quote logic, file upload, backend, database, auth/RBAC, contract, or business rule changes.
- No SCADA behavior, equipment telemetry, automated engineering decisions, external imagery, or production deployment.

## Delivery status

- Code commit `14c1245` and task checkpoint commit are on PR #9: https://github.com/CrazyMotoCat/STDU_SHOP/pull/9. Both independent follow-up reviews passed; fresh `origin/main` and parallel-branch compatibility checks passed. The full workflow must pass for the current PR HEAD. Local host smoke is blocked by the active R1-001 API listener.
- AUTO_MERGE remains gated on required exact-HEAD GitHub checks, approvals, no blocking reviews/threads, clean compatibility with current main, and successful integration. Host smoke limitation must be represented honestly if CI does not provide equivalent evidence.
