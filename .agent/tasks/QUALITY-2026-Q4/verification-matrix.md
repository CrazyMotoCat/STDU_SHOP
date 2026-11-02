# QUALITY-2026-Q4 — Q0-03 verification matrix

Основа ветки: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. Сверять hosted checks только с точным текущим PR HEAD.

| Gate | Команда / evidence | Результат |
|---|---|---|
| RED | `(workdir: services/ingestion) .venv/Scripts/python.exe -m pytest tests/test_catalog_import_parser.py -q` до фикса | 19 failed, 12 passed; воспроизведены отрицательные индексы, координаты, overflow, типы и malformed relationships; один путь давал непойманный KeyError. |
| Ingestion parser/HTTP GREEN | `services/ingestion/.venv/Scripts/python.exe -m pytest services/ingestion/tests -q` | PASS after relationship review fixes: 51 passed. FastAPI TestClient confirms typed HTTP 415/no NDJSON for late structure errors, missing-Id and wrong-Type; source-relative target resolution, linked styles/shared strings, int32 maximum, sparse/out-of-order, supported cell types and rejects are covered. One upstream Starlette/httpx deprecation warning. |
| Nest/API disposable PostgreSQL | `$env:PYTHONPATH = (Resolve-Path 'services/ingestion/src').Path; pnpm test:r1-006b` | PASS, exit 0; поздний row overflow вернул `FILE_REJECTED`; run, file object и rows отсутствуют; sentinel БД сохранён. Изолированный Compose namespace, без named volumes; cleanup штатный. |
| Full Vitest | `pnpm exec vitest run` | PASS: 15 files passed, 5 skipped; 114 passed, 89 skipped. Runtime R1-006B запускается отдельно указанной командой. |
| API TypeScript | `pnpm --filter @stdu/api exec prisma generate` с только локальным dummy `MIGRATION_DATABASE_URL`, затем `pnpm --filter @stdu/api exec tsc --noEmit` | PASS. Prisma schema/client generation не подключалась к БД и tracked schema не меняла. |
| TypeScript formatting | `pnpm exec prettier --check apps/api/test/r1-006b.import.runtime.test.ts` | PASS. |
| Whitespace | `git diff --check` | PASS. |
| Python aggregate lint/format/typecheck | `pnpm lint`, `pnpm format:check`, `pnpm typecheck` | NOT RUN locally: `uv` отсутствует в среде; `ruff`/`mypy` не подменялись непроверенным toolchain. Требуемые hosted checks должны пройти на точном PR HEAD. |
| Hosted exact-head CI | GitHub PR Checks | Ожидается после push. Финальный отчёт указывает SHA и фактический результат GitHub Actions. |
| Contracts, migrations, production | Contract generation/check, migration apply, production action | NOT RUN / OUT OF SCOPE; публичные и DB контракты не менялись. |
| Independent review | Read-only reviewer по финальному diff | First pass found two P2 relationship path issues; source-relative resolution and relationship-based styles/shared strings fixes and collision/orphan regressions added. Final read-only re-review PASS, no actionable P1/P2. Static review only; hosted exact-head CI remains separate. |

## Условия acceptance

- Максимум PostgreSQL signed integer принимается, следующий номер отклоняется до staging.
- No NDJSON prefix/header отправляется при поздней malformed XLSX структуре.
- Некорректные relationship атрибуты/типы и неизвестные `cell@t` дают контролируемую typed ошибку.
- Sparse cells/rows и unusual XML order сохраняются; последовательность координат не навязывается.
- Ни один frozen contract, миграция, approval gate или production resource не изменён.
