# QUALITY-2026-Q4 — verification matrix

**Verification source:** isolated branch based on `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. Implementation and local checks were committed as `87f905b`; task checkpoint commits may follow. The exact-HEAD hosted gate must always be read from the latest SHA on [Draft PR #30](https://github.com/CrazyMotoCat/STDU_SHOP/pull/30).

| Gate | Command/evidence | Result |
|---|---|---|
| RED regression before fix | `pnpm exec vitest run apps/web/src/app/staff/suppliers/supplier-create-idempotency.test.ts` | Expected RED: 4 tests total, 2 failed (same body received a fresh key; changed body silently overwrote prior key), 2 passed. |
| Client retry helper | Same targeted Vitest command after fix; also included in `pnpm test` | PASS: 4/4 helper tests, including same-body key reuse, changed-body confirmation boundary, staff identity isolation, and single-flight double-submit. Storage assertion verifies supplier name/tax identifier are absent; only key and SHA-256 body hash are stored. |
| Real API + disposable PostgreSQL | `pnpm test:r1-007b` | PASS: 12/12. The test proxy forwards create POST, consumes the actual upstream 201, destroys downstream before response headers, and confirms client `fetch` failure. It verifies commit, restarts API, retries exact key/body, and checks one supplier, revision, immutable idempotency receipt, audit event, and one offer. Body mismatch remains 409; same-key concurrency replays one entity. Runtime Compose namespace was unique; no shared containers or named volumes. |
| Supplier frozen API contract | `pnpm supplier:contract:check` | PASS: route inventory, permissions, idempotency headers and unlink receipt parity across 20 operations. |
| Other frozen contracts | `pnpm contract:check` | PASS: Staff OpenAPI semantic equality (23 operations), Inquiry frozen amendment (15 operations), and reproducible generated TypeScript client. |
| Formatting | `pnpm format:check` | PASS; all matched files use Prettier style; 6 Python files already formatted. |
| Lint | `pnpm lint` | PASS; all checks passed. |
| Typecheck | `pnpm typecheck` | PASS; web/API/staff-client typechecks completed. |
| Full tests | `pnpm test` | PASS: Vitest 16 files passed, 5 skipped; 118 passed, 89 skipped. Ingestion pytest: 15 passed, 1 upstream Starlette deprecation warning. |
| Build | `pnpm build` | PASS: API, staff client, Next.js optimized build, and ingestion wheel/sdist. |
| Whitespace | `git diff --check` | PASS after final documentation edits. |
| Independent review | `review_q0_01` read-only review and focused response-drop re-review | PASS; no BLOCKER/HIGH findings. Proxy confirms actual response loss; no API/DB contract changed. |
| Hosted exact-HEAD CI | GitHub PR #30 check suite for the latest PR HEAD | Recheck live on the latest SHA before handoff; earlier runs are insufficient after any later commit. |
| Browser-mounted Staff UI test | Playwright against authenticated Staff UI | NOT_RUN. Helper unit coverage and API/PG runtime cover the requested retry/DB boundary; no mounted browser integration was added. |
| Production/merge | Production action or merge | NOT_RUN; explicitly excluded. |

## Resolved local setup/iteration failures

- Initial API runtime harness could not import generated Prisma client. Ran `pnpm --filter @stdu/api db:generate`; rerun passed.
- Initial typecheck found a test union narrowing issue; narrowed `first.kind` and reran successfully.
- Initial Next build rejected `.js` import for the web helper; changed the web import to extensionless and reran build successfully.
- Contract export initially required local config. Inspected `scripts/env-init.mjs`, confirmed it creates ignored development-only random credentials without printing them, ran `pnpm env:init`, then both contract checks passed. `.env.local` remains ignored.
- First transport-proxy runtime assertion still expected the former test-only exception; updated it to expect the actual client fetch failure and reran `pnpm test:r1-007b` successfully.

## Environment warnings

- Commands report Node `v24.22.1` while repository requests `v24.19.0`; checks completed under the installed version.
- The PostgreSQL runtime run emits an existing `pg` query concurrency deprecation warning. No migration or production database was used.
