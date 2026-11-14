# QUALITY-2026-Q4 — reconciled state

## Current integration checkpoint — 2026-11-03

- Active task: Q0-01 / AUD-029, existing Draft PR #30, REVIEW_REQUIRED / NO_MERGE. Only preparation is authorized; no production or frozen-contract change.
- Current integration main: `4c0d2f7310f7040091de38b76ed992449b18b539`, owner-approved Q0-04 merge, exact post-merge CI [41615617436](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41615617436) SUCCESS.
- Q0-03 is INTEGRATED / VERIFIED at `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`; Q0-04 is INTEGRATED / VERIFIED at `4c0d2f7310f7040091de38b76ed992449b18b539`. VIS-CAT-01 upstream files are preserved.
- This reconciliation resolves documentation add/add conflicts only. It preserves both complete source snapshots below; no finding, historical test result, failed-run evidence or scope limitation is discarded.
- Historical `current`, `NOT_STARTED`, Draft/NO_MERGE and agent-freeze statements below apply to their dated source snapshots, not today's integration state. Current owner authorization controls this task; historical instructions do not expand or restrict that authorization.
- Q0-03 fixes AUD-003/011/012/013/025/026; Q0-04 fixes AUD-010/021/024. These integrated package results supersede their historical pre-fix classifications. Other findings retain their documented evidence limits; this task does not revalidate or implement new QUALITY packages.
- Q0-01 source is preserved from old PR HEAD `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`. Fresh regressions, independent review and exact-final-HEAD CI must be completed after this main merge; the final PR handoff records current results. Supplier API/DB/RBAC/session/CSRF contracts remain frozen.

## Historical Q0-01 source — complete preserved snapshot

Source commit `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`, Git blob `7cbe923bf551395771f05f9da1c892dc1e0630f0`.

# QUALITY-2026-Q4 — состояние

**Дата:** 2 ноября 2026 (Asia/Vladivostok)

**Текущий этап:** Q0-01 завершён как owner-review package; Playwright acceptance, independent focused re-review, local gates и exact-head hosted CI прошли. PR #30 остаётся Draft. Далее — отдельный Q0-03 worktree от свежего `origin/main`.
**Статус:** `REVIEW_REQUIRED`

## Репозиторий и доставка

- Исторический снимок аудита: `55281be07e8d6938c8b1a6ba6988e188b7fc642b`.
- Текущий `origin/main` после свежего fetch: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`; совпадает с базой перепроверки 30 октября.
- Рабочая ветка: `codex/quality-q0-01-supplier-idempotency`, создана от `origin/main` в изолированном worktree `C:\Users\mvideo\.codex\worktrees\quality-q0-01-supplier-idempotency\SHOP STDU`.
- Режим доставки: `REVIEW_REQUIRED`; merge запрещён задачей. Production и миграции не затрагивались.
- PR: [#30](https://github.com/CrazyMotoCat/STDU_SHOP/pull/30), base `main` (`336ec8ed`), head `codex/quality-q0-01-supplier-idempotency`; PR создан как Draft. Проверять только актуальные проверки последнего SHA PR HEAD.
- Исходный checkout `codex/r1-006b-catalog-import` оставлен без изменений. PR #28 и его worktree не редактировались.

## Перепроверка

Все AUD-001…AUD-035 перепроверены по текущему `main`. Их актуальные статусы, evidence, ограничения доказательств и минимальные DoD находятся в `findings-registry.md`. Новых подтверждённых P0/P1 в этой группе не найдено. Важно не считать статические/синтетические результаты доказательством production-инцидента.

## Q0-01

- Root cause подтверждён: `SupplierWorkspace` создавал новый `Idempotency-Key` на каждый mutation request; submit создания поставщика не удерживал ключ и тело между повторами.
- Browser acceptance выявила связанный UI-дефект: после входа оставался login-bound CSRF token, непригодный для staff-bound supplier mutation. После успешного входа UI теперь запрашивает session-bound CSRF token; API/auth contracts и backend не менялись.
- При начавшемся запросе без подтверждённого результата UI показывает явное предупреждение неопределённого исхода и сохраняет ключ/хэш для same-body retry. Определённый клиентский отказ (<500, кроме `IDEMPOTENCY_KEY_REUSED`) очищает попытку.
- Изменение ограничено Staff UI и регрессионной проверкой runtime API. OpenAPI, DTO, RBAC, схема/миграции, серверный алгоритм idempotency, audit и security boundaries не менялись.
- Клиент хранит в `sessionStorage`, привязанном к ID сотрудника, только случайный ключ и SHA-256 отпечаток тела; исходное тело поставщика не сохраняется.
- При повторе того же тела повторно используется тот же ключ. При изменённом теле незавершённой операции пользователь должен явно подтвердить новую операцию.
- RED зафиксирован до исправления: 2 из 4 новых helper-тестов падали на повторе ключа и тихой замене операции. После исправления все 4 проходят.
- Runtime acceptance использует disposable PostgreSQL, реальный Next.js Staff UI и реальный API. Playwright `route.fetch()` получает фактический upstream 201/body после commit, затем `route.abort('connectionreset')`; browser фиксирует `requestfailed` и не получает HTTP success response. После reload и повторного входа тот же ключ/тело воспроизводят прежнюю запись. Отдельный сценарий проверяет double-click, changed-body cancel/confirm и новый ключ.
- `pnpm test:r1-007b`: PASS 14/14 в двух последовательных запусках (12 API/PostgreSQL сценариев + 2 browser acceptance); disposable DB sentinel сохранён в обоих.
- `pnpm typecheck`, `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm supplier:contract:check`, `pnpm contract:check`, `git diff --check`: PASS на Q0-01 code commit `36abf7d738299e0db74e4974112b75b1fd883107`.
- Hosted exact-head CI: PASS, run [#41427550204](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41427550204), check `quality-and-integration`, SHA `36abf7d738299e0db74e4974112b75b1fd883107`. PR remains Draft and unmerged.
- Первый независимый review выявил P2 mismatch в тестовом proxy; исправлено на реальный upstream response + client-side connection abort. Focused re-review: PASS, замечание закрыто, иных замечаний нет.

## Следующие действия

1. Зафиксировать checkpoint Q0-01 и проверить documentation commit на точном HEAD CI.
2. Начать отдельный Q0-03 worktree/branch от заново подтверждённого `origin/main`.
3. Оставить оба PR в Draft; merge и production не выполнять.

## Historical Q0-03 source — complete preserved snapshot

Source main `4c0d2f7310f7040091de38b76ed992449b18b539`, Git blob `afeac8430c891a6b795f79047f8e59ae089057c5`. Detailed Q0-04 evidence remains in `Q0-04/` and its [post-merge handoff](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38#issuecomment-6600830728).

# QUALITY-2026-Q4 — состояние Q0-03

**Дата:** 2 ноября 2026 (Asia/Vladivostok)

**Задача:** Q0-03 — строгая структура XLSX.
**Статус:** `DRAFT_PR_OPEN`.

## Репозиторий и доставка

- База: свежий `origin/main` `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`.
- Ветка: `codex/quality-q0-03-xlsx-strict-structure`.
- Draft PR: [#35](https://github.com/CrazyMotoCat/STDU_SHOP/pull/35); current PR HEAD at this checkpoint `b1c17e144bfbaec3d55efb6bedb94c03c8d0ef55`.
- Изолированный worktree: `C:\Users\mvideo\.codex\worktrees\quality-q0-03-xlsx-strict-structure\SHOP STDU`.
- Режим: `REVIEW_REQUIRED / DRAFT_PR_OPEN / NO_MERGE`; задача требует оставить PR в Draft и запрещает merge.
- Изменения затрагивают только Python ingestion parser, его тесты, disposable R1-006B runtime test и `.agent/tasks/QUALITY-2026-Q4/*`.
- Схема, миграции, OpenAPI, DTO, RBAC, публичный API и production не менялись.

## Требования и границы

- Трассировка: `CAT-05`, `SPEC-01`, `SPEC-02`; acceptance `E2E-03`, `E2E-07`, `E2E-19`; backlog `R1-008` и `R1-011`; решения #6, #7, #25, #27, #62.
- Аудит-пакет: AUD-003, AUD-011, AUD-012, AUD-013, AUD-025, AUD-026. Перепроверка по базе `336ec8e`; детали и ограничения доказательств — в `findings-registry.md`.
- Сохраняются sparse-строки и ячейки, включая необычный порядок XML; повторные координаты отклоняются.
- Типы `n`/default, `s`, `inlineStr`, `b`, `str`, `e`, формулы и пустые ячейки сохраняют имеющееся отображение. Тип `d` и неизвестные типы отклоняются.
- Верхняя граница исходного номера строки — PostgreSQL `integer` (`2_147_483_647`); иные ограничения R1 остаются прежними.
- Исключены AUD-005/016, 010/021/024/030, R1-010D, CLEAN, supplier/auth/UI, массовые импорты, новые схемы/контракты и production.

## Реализация и проверка

- Стиль и shared-string индексы проверяются до обращения к массивам; отрицательный и верхний выход завершаются `FILE_REJECTED`.
- Проверяются workbook relationships: обязательные `Id`/`Type`/`Target`, уникальность ID, internal target, безопасный путь, существующая часть, связь package→workbook и точный тип `worksheet` для каждой вкладки.
- Каждый target разрешается относительно source part. Worksheets, styles и shared strings читаются только по workbook relationships; orphan parts с каноническим именем не подменяют связанные части.
- Worksheet обрабатывается потоково. Проверяются root/`sheetData`, положительные int32-номера, соответствие `row@r` и `cell@r`, дубликаты строк и ячеек, allowlist `cell@t`.
- FastAPI preflight продолжает полностью разбирать и ограничивать каждую запись до отправки NDJSON заголовков. Поздняя структурная ошибка возвращает JSON 415; API runtime с disposable PostgreSQL подтверждает отсутствие persisted import, file object и строк.
- RED до исправления: первоначальный набор — 19 ожидаемых падений и 12 проходов. После исправления ingestion suite — 51 passed.
- Первый независимый review нашёл две P2 в OPC target resolution и выборе styles/shared strings. Исправлено: source-relative разрешение и relationship-based part lookup; добавлены фикстуры с конфликтующими и orphan ZIP entries. Финальный independent read-only review: PASS, actionable P1/P2 не осталось.
- После review fixes R1-006B disposable runtime повторно завершился с exit 0, sentinel сохранён.
- Полная команда `pnpm exec vitest run`: 15 files passed, 5 skipped; 114 passed, 89 skipped. R1-006B disposable runtime завершился с exit 0, sentinel сохранён.
- После lint/type fixes проходят `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, ingestion suite (51 passed), и повторный `pnpm test:r1-006b` с disposable PostgreSQL (exit 0; sentinel сохранён). Typecheck fix: тестовая XLSX Buffer копируется в `Uint8Array` перед созданием Blob.
- История exact-head CI: run #156 (`41434591569`) на `cbce62abe9daabbb9236c897aaf54e701d8bc3a6` завершился failure в `pnpm lint`; локально воспроизведены 21 UP012 и 3 E501 в новых Python файлах и исправлены. Run #158 (`41435435716`) на `a20ecafb50989b0e1c5b6a76cebab2c40e85d5d4` завершился success. Последний сверенный run #160 (`41437332904`) на текущем тогда PR HEAD `b1c17e144bfbaec3d55efb6bedb94c03c8d0ef55` завершился success.
- Полный `pnpm exec vitest run` ранее прошёл: 15 files passed, 5 skipped; 114 passed, 89 skipped. Upstream Node 24.22.1 отличается от закреплённого 24.19.0; предупреждение engine не блокировало проверки.
- Одна upstream Starlette/httpx deprecation warning в локальной TestClient suite; тесты прошли.

## Handoff

- Q0-03 подготовлен в отдельном Draft PR #35; точная история hosted CI записана в `verification-matrix.md`.
- Сохранить PR открытым в статусе Draft; merge и следующий audit-пакет не входят в эту задачу.
