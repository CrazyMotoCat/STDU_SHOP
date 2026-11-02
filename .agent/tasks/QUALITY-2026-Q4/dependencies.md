# QUALITY-2026-Q4 — зависимости и границы Q0-03

## База и ownership

- `origin/main`: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`, fresh fetch на старте Q0-03.
- Изолированная ветка `codex/quality-q0-03-xlsx-strict-structure`; единственный writer — lead.
- Исходный пользовательский checkout `codex/r1-006b-catalog-import` оставлен неизменённым.
- Q0-01 worktree и PR #30 не редактировались этой работой. Exact docs-head run PR #30: #41429744152, success на `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`.

## Запреты соседних потоков

- PR #28/#29 и их worktrees не редактировать и не чистить.
- Владелец снял FREEZE для Агента 2; Агент 2 самостоятельно ведёт публичный каталог / Product Media. Его worktree и файлы принадлежат этому потоку и не редактируются Q0-03/Q0-04.
- R1-010D scanner/contract, private-storage boundaries и CLEAN policy не менялись.
- Не переносить изменения Q0-01 в эту ветку; Q0-03 основан на `origin/main`.
- Не применять миграции, не менять DB/OpenAPI/auth/shared DTO и не трогать production.

## Frozen requirements/contracts

- `CAT-05`, `SPEC-01/02`; `E2E-03/07/19`; backlog `R1-008/011`; approved decisions #6, #7, #25, #27, #62.
- Python ingestion возвращает staged candidates; NestJS остаётся владельцем бизнес-состояния, прав и транзакции.
- NDJSON protocol version 1 не менялся; `ImportParseError` использует существующие `FILE_REJECTED`/status semantics.
- При невалидном XLSX parser preflight завершается до NDJSON response. Nest staging transaction откатывается и не оставляет source file/version, import run или rows.

## Интеграционные зависимости

- `apps/api/src/catalog-import/import-parser.client.ts` остаётся без изменений: strict parser preserves its existing record shape and cell type enums.
- `apps/api/src/catalog-import/catalog-import.service.ts` и PostgreSQL staging schema остаются без изменений; runtime acceptance использует существующую disposable R1-006B harness.
- Hosted CI и независимый read-only review обязательны до завершения. PR должен быть отдельным Draft и остаться без merge.
