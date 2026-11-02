# QUALITY-2026-Q4 — verification matrix

**Verification source:** isolated branch based on `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. Earlier implementation/local gates were committed as `87f905b`; browser acceptance changes are currently uncommitted. The exact-HEAD hosted gate must always be read from the latest SHA on [Draft PR #30](https://github.com/CrazyMotoCat/STDU_SHOP/pull/30).

| Gate | Command/evidence | Result |
|---|---|---|
| RED regression before fix | `pnpm exec vitest run apps/web/src/app/staff/suppliers/supplier-create-idempotency.test.ts` | Expected RED: 4 tests total, 2 failed (same body received a fresh key; changed body silently overwrote prior key), 2 passed. |
| Client retry helper | Same targeted Vitest command after fix; also included in `pnpm test` | PASS: 4/4 helper tests, including same-body key reuse, changed-body confirmation boundary, staff identity isolation, and single-flight double-submit. Storage assertion verifies supplier name/tax identifier are absent; only key and SHA-256 body hash are stored. |
| Real API + disposable PostgreSQL | `pnpm test:r1-007b` | PASS: 14/14 in two consecutive runs. Existing API tests retain actual HTTP 201 drop, API restart, exact key/body replay, one supplier/revision/immutable receipt/audit/offer, body-mismatch 409, and same-key concurrency. Two Playwright tests mount the real Staff UI against a separate HTTPS proxy and disposable API/PG. `route.fetch()` completes the real upstream create; the test records its 201/body after commit, calls `route.abort('connectionreset')`, and asserts browser `requestfailed` before retry. Exact same-body retry succeeds with one committed supplier/revision/receipt/audit. Unique synthetic INNs avoid test-order collisions. Runtime Compose namespace was unique; no shared containers or named volumes. |
| Supplier frozen API contract | `pnpm supplier:contract:check` | PASS: route inventory, permissions, idempotency headers and unlink receipt parity across 20 operations. |
| Other frozen contracts | `pnpm contract:check` | PASS: Staff OpenAPI semantic equality (23 operations), Inquiry frozen amendment (15 operations), and reproducible generated TypeScript client. |
| Formatting | `pnpm format:check` | PASS; all matched files use Prettier style; 6 Python files already formatted. |
| Lint | `pnpm lint` | PASS; all checks passed. |
| Typecheck | `pnpm typecheck` | PASS; web/API/staff-client typechecks completed. |
| Full tests | `pnpm test` | PASS: Vitest 16 files passed, 5 skipped; 118 passed, 91 skipped (includes the two runtime tests that run separately under disposable services). Ingestion pytest: 15 passed, 1 upstream Starlette deprecation warning. |
| Build | `pnpm build` | PASS: API, staff client, Next.js optimized build, and ingestion wheel/sdist. |
| Whitespace | `git diff --check` | PASS after current code and checkpoint edits. |
| Independent review | `review_q0_01` read-only review and focused response-drop re-review | First review found P2 mismatch when the proxy returned empty 201. Replaced with Playwright upstream fetch + connection abort and browser `requestfailed` assertion. Focused re-review PASS; no remaining findings. |
| Hosted exact-HEAD CI | GitHub PR #30 check suite for the latest PR HEAD | Pending push of current browser-acceptance commit; then verify latest SHA. Earlier runs are insufficient after any later commit. |
| Browser-mounted Staff UI test | `pnpm test:r1-007b` | PASS: 2/2 browser scenarios. Authenticated Next.js Staff UI; double-click single-flight; dropped upstream 201 with browser `requestfailed`; uncertain-result alert; same-body/same-key retry after logout/login and full reload; one supplier/revision/receipt/audit; no supplier PII in browser storage; changed-body cancel causes no request; explicit confirmation creates a separate supplier with a new key. Staff identity isolation is covered by the helper unit test. |
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
