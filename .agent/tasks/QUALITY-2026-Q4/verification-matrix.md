# QUALITY-2026-Q4 — reconciled verification-matrix

## Current integration checkpoint — 2026-11-03

- Active task: Q0-01 / AUD-029, existing Draft PR #30, REVIEW_REQUIRED / NO_MERGE. Only preparation is authorized; no production or frozen-contract change.
- Current integration main: `4c0d2f7310f7040091de38b76ed992449b18b539`, owner-approved Q0-04 merge, exact post-merge CI [41615617436](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41615617436) SUCCESS.
- Q0-03 is INTEGRATED / VERIFIED at `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`; Q0-04 is INTEGRATED / VERIFIED at `4c0d2f7310f7040091de38b76ed992449b18b539`. VIS-CAT-01 upstream files are preserved.
- This reconciliation resolves documentation add/add conflicts only. It preserves both complete source snapshots below; no finding, historical test result, failed-run evidence or scope limitation is discarded.
- Historical `current`, `NOT_STARTED`, Draft/NO_MERGE and agent-freeze statements below apply to their dated source snapshots, not today's integration state. Current owner authorization controls this task; historical instructions do not expand or restrict that authorization.
- Q0-03 fixes AUD-003/011/012/013/025/026; Q0-04 fixes AUD-010/021/024. These integrated package results supersede their historical pre-fix classifications. Other findings retain their documented evidence limits; this task does not revalidate or implement new QUALITY packages.
- Q0-01 source is preserved from old PR HEAD `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`. Fresh regressions, independent review and exact-final-HEAD CI must be completed after this main merge; the final PR handoff records current results. Supplier API/DB/RBAC/session/CSRF contracts remain frozen.

## Historical Q0-01 source — complete preserved snapshot

Source commit `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`, Git blob `03f59d51e8fb7c818ff057cc20e1c9a938687313`.

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
| Hosted exact-HEAD CI | [PR #30 run #41427550204](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41427550204) | PASS: `quality-and-integration` succeeded on exact Q0-01 code SHA `36abf7d738299e0db74e4974112b75b1fd883107`. A subsequent docs-only checkpoint commit is pending its own exact-head run. |
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

## Historical Q0-03 source — complete preserved snapshot

Source main `4c0d2f7310f7040091de38b76ed992449b18b539`, Git blob `8daf4cd731c6a47812b44b1e13d09c1926c38519`. Detailed Q0-04 evidence remains in `Q0-04/` and its [post-merge handoff](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38#issuecomment-6600830728).

# QUALITY-2026-Q4 — Q0-03 verification matrix

Основа ветки: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. Сверять hosted checks только с точным текущим PR HEAD.

| Gate | Команда / evidence | Результат |
|---|---|---|
| RED | `(workdir: services/ingestion) .venv/Scripts/python.exe -m pytest tests/test_catalog_import_parser.py -q` до фикса | 19 failed, 12 passed; воспроизведены отрицательные индексы, координаты, overflow, типы и malformed relationships; один путь давал непойманный KeyError. |
| Ingestion parser/HTTP GREEN | `services/ingestion/.venv/Scripts/python.exe -m pytest services/ingestion/tests -q` | PASS after relationship review fixes: 51 passed. FastAPI TestClient confirms typed HTTP 415/no NDJSON for late structure errors, missing-Id and wrong-Type; source-relative target resolution, linked styles/shared strings, int32 maximum, sparse/out-of-order, supported cell types and rejects are covered. One upstream Starlette/httpx deprecation warning. |
| Nest/API disposable PostgreSQL | `$env:PYTHONPATH = (Resolve-Path 'services/ingestion/src').Path; pnpm test:r1-006b` | PASS, exit 0; поздний row overflow вернул `FILE_REJECTED`; run, file object и rows отсутствуют; sentinel БД сохранён. Изолированный Compose namespace, без named volumes; cleanup штатный. |
| Full Vitest | `pnpm exec vitest run` | PASS: 15 files passed, 5 skipped; 114 passed, 89 skipped. Runtime R1-006B запускается отдельно указанной командой. |
| API / workspace / Python typecheck | `pnpm typecheck` | PASS after Buffer-to-Uint8Array test fixture fix. Prisma client generation used only local dummy `MIGRATION_DATABASE_URL`; no database connection or tracked schema changes. |
| TypeScript formatting | `pnpm exec prettier --check apps/api/test/r1-006b.import.runtime.test.ts` | PASS. |
| Whitespace | `git diff --check` | PASS. |
| Aggregate lint / format | `pnpm lint`; `pnpm format:check` | PASS after fixing 21 UP012 and 3 E501 reported by the first hosted run. |
| Hosted exact-head CI history | PR #35 run #156 `#41434591569` on `cbce62abe9daabbb9236c897aaf54e701d8bc3a6`; run #158 `#41435435716` on `a20ecafb50989b0e1c5b6a76cebab2c40e85d5d4`; latest verified run #160 `#41437332904` on `b1c17e144bfbaec3d55efb6bedb94c03c8d0ef55` | Run #156 failed at `pnpm lint`; run #158 passed on its then-current SHA; run #160 passed on the then-current PR HEAD `b1c17e1`. The later Q0-03 docs-only follow-up must be checked against its own exact pushed SHA. |
| Contracts, migrations, production | Contract generation/check, migration apply, production action | NOT RUN / OUT OF SCOPE; публичные и DB контракты не менялись. |
| Independent review | Read-only reviewer по финальному diff | First pass found two P2 relationship path issues; source-relative resolution and relationship-based styles/shared strings fixes and collision/orphan regressions added. Final read-only re-review PASS, no actionable P1/P2. Subsequent edits are lint/format and a type-safe byte copy in the runtime fixture. |

## Условия acceptance

- Максимум PostgreSQL signed integer принимается, следующий номер отклоняется до staging.
- No NDJSON prefix/header отправляется при поздней malformed XLSX структуре.
- Некорректные relationship атрибуты/типы и неизвестные `cell@t` дают контролируемую typed ошибку.
- Sparse cells/rows и unusual XML order сохраняются; последовательность координат не навязывается.
- Ни один frozen contract, миграция, approval gate или production resource не изменён.
