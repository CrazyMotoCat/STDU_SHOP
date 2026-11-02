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
