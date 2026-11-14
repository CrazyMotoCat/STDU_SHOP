# QUALITY-2026-Q4 — reconciled dependencies

## Current integration checkpoint — 2026-11-03

- Active task: Q0-01 / AUD-029, existing Draft PR #30, REVIEW_REQUIRED / NO_MERGE. Only preparation is authorized; no production or frozen-contract change.
- Current integration main: `4c0d2f7310f7040091de38b76ed992449b18b539`, owner-approved Q0-04 merge, exact post-merge CI [41615617436](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41615617436) SUCCESS.
- Q0-03 is INTEGRATED / VERIFIED at `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`; Q0-04 is INTEGRATED / VERIFIED at `4c0d2f7310f7040091de38b76ed992449b18b539`. VIS-CAT-01 upstream files are preserved.
- This reconciliation resolves documentation add/add conflicts only. It preserves both complete source snapshots below; no finding, historical test result, failed-run evidence or scope limitation is discarded.
- Historical `current`, `NOT_STARTED`, Draft/NO_MERGE and agent-freeze statements below apply to their dated source snapshots, not today's integration state. Current owner authorization controls this task; historical instructions do not expand or restrict that authorization.
- Q0-03 fixes AUD-003/011/012/013/025/026; Q0-04 fixes AUD-010/021/024. These integrated package results supersede their historical pre-fix classifications. Other findings retain their documented evidence limits; this task does not revalidate or implement new QUALITY packages.
- Q0-01 source is preserved from old PR HEAD `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`. Fresh regressions, independent review and exact-final-HEAD CI must be completed after this main merge; the final PR handoff records current results. Supplier API/DB/RBAC/session/CSRF contracts remain frozen.

## Historical Q0-01 source — complete preserved snapshot

Source commit `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`, Git blob `c7957d798f61c47c5cd0f57aa0841022a344c73e`.

# QUALITY-2026-Q4 — зависимости и границы

## Текущая база и ownership

- `origin/main`: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`, подтверждён свежим fetch 1 ноября 2026.
- Исторический audit snapshot: `55281be07e8d6938c8b1a6ba6988e188b7fc642b`.
- Текущий checkout пользователя изначально был на чистой feature-ветке `codex/r1-006b-catalog-import` SHA `6d34038936614fce7afe2f8d6efc12b93e04aa67`; работу ведём в отдельном worktree от `origin/main`.
- Единственный write owner этой итерации — lead; независимые аудиторы/ревьюеры были read-only.
- Открытые/неотслеживаемые файлы других worktree не переносились и не менялись.

## PR #28 — R1-010D Stage B

- PR #28 остаётся открытым Draft; head `270131d36f5d54fc5035785e269f5eefcce729ff`, base `336ec8e`.
- Изменения PR #28, R1-010D worker/finalizer, scan contracts, private-storage boundaries и CLEAN policy запрещены в этой задаче.
- Worktree `r1-010d-stage-b` содержит собственные файлы и untracked verification logs; не редактировать, не чистить и не останавливать его ресурсы.
- Q0-01 изменяет только `apps/web/src/app/staff/suppliers/*`, `apps/api/test/r1-007b.supplier.runtime.test.ts` и `.agent/tasks/QUALITY-2026-Q4/*`; конфликта по файлам нет.
- Q0-06 download abort остаётся заблокирован до исключения зависимости с PR #28.

## Агент 2 и соседние задачи

- Агент 2 остаётся на FREEZE; задачи не передавались.
- R1-011+ и production не затрагиваются.
- R1-007 supplier domain contract/API/DB остаётся frozen: в Q0-01 нет DTO/OpenAPI/route/schema/migration/permission edits.

## Acceptance/contract gates

- Требование: Roadmap `R1-007` (supplier domain/offers, строгая SKU linkage, ручное одобрение associations); staff session/CSRF/RBAC invariants остаются backend-owned.
- Серверная гарантия same actor/key/body, advisory lock, immutable receipt и audit уже есть на базе; Q0-01 исправляет только клиентскую логическую операцию.
- Переход к следующему пакету потребует отдельной задачи/owner decision и повторной проверки актуальной базы.

## Historical Q0-03 source — complete preserved snapshot

Source main `4c0d2f7310f7040091de38b76ed992449b18b539`, Git blob `205cd4dae05953fed2d3b334bb58940a1b4995ce`. Detailed Q0-04 evidence remains in `Q0-04/` and its [post-merge handoff](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38#issuecomment-6600830728).

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
