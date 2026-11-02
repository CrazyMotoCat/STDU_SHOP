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
| Hosted exact-head CI history | PR #35 run #156 `#41434591569` on `cbce62abe9daabbb9236c897aaf54e701d8bc3a6`; run #158 `#41435435716` on `a20ecafb50989b0e1c5b6a76cebab2c40e85d5d4` | First run failed at `pnpm lint`; fixes passed locally. Second exact-head run completed success. |
| Contracts, migrations, production | Contract generation/check, migration apply, production action | NOT RUN / OUT OF SCOPE; публичные и DB контракты не менялись. |
| Independent review | Read-only reviewer по финальному diff | First pass found two P2 relationship path issues; source-relative resolution and relationship-based styles/shared strings fixes and collision/orphan regressions added. Final read-only re-review PASS, no actionable P1/P2. Subsequent edits are lint/format and a type-safe byte copy in the runtime fixture. |

## Условия acceptance

- Максимум PostgreSQL signed integer принимается, следующий номер отклоняется до staging.
- No NDJSON prefix/header отправляется при поздней malformed XLSX структуре.
- Некорректные relationship атрибуты/типы и неизвестные `cell@t` дают контролируемую typed ошибку.
- Sparse cells/rows и unusual XML order сохраняются; последовательность координат не навязывается.
- Ни один frozen contract, миграция, approval gate или production resource не изменён.
