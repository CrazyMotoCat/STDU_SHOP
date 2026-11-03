# QUALITY-2026-Q4 — reconciled remediation-plan

## Current integration checkpoint — 2026-11-03

- Active task: Q0-01 / AUD-029, existing Draft PR #30, REVIEW_REQUIRED / NO_MERGE. Only preparation is authorized; no production or frozen-contract change.
- Current integration main: `4c0d2f7310f7040091de38b76ed992449b18b539`, owner-approved Q0-04 merge, exact post-merge CI [41615617436](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41615617436) SUCCESS.
- Q0-03 is INTEGRATED / VERIFIED at `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`; Q0-04 is INTEGRATED / VERIFIED at `4c0d2f7310f7040091de38b76ed992449b18b539`. VIS-CAT-01 upstream files are preserved.
- This reconciliation resolves documentation add/add conflicts only. It preserves both complete source snapshots below; no finding, historical test result, failed-run evidence or scope limitation is discarded.
- Historical `current`, `NOT_STARTED`, Draft/NO_MERGE and agent-freeze statements below apply to their dated source snapshots, not today's integration state. Current owner authorization controls this task; historical instructions do not expand or restrict that authorization.
- Q0-03 fixes AUD-003/011/012/013/025/026; Q0-04 fixes AUD-010/021/024. These integrated package results supersede their historical pre-fix classifications. Other findings retain their documented evidence limits; this task does not revalidate or implement new QUALITY packages.
- Q0-01 source is preserved from old PR HEAD `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`. Fresh regressions, independent review and exact-final-HEAD CI must be completed after this main merge; the final PR handoff records current results. Supplier API/DB/RBAC/session/CSRF contracts remain frozen.

## Historical Q0-01 source — complete preserved snapshot

Source commit `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3`, Git blob `623b43e140a6040e178a8cbe6365e191122e6754`.

# QUALITY-2026-Q4 — план исправлений

Пакеты независимы; отдельный PR на пакет. В рамках текущего разрешения реализуется только Q0-01. Другие пакеты не начинать автоматически.

## Q0 — корректность, безопасность, надёжность

| Пакет | Findings | Минимальное изменение и DoD | Effort / риск / зависимости | Статус |
|---|---|---|---|---|
| Q0-01 STAFF-SUPPLIER-IDEMPOTENCY | AUD-029 | Один key/body в пределах логической операции; single-flight; same-body retry после transport failure/reload; changed-body не переиспользует ключ молча; реальный API+PG commit/response-drop/replay с одной supplier, revision, audit receipt и одной offer записью. | S–M / средний / без изменения API и БД | Owner-review package готов; PR #30 Draft; exact-head CI PASS на `36abf7d`; AUD-029 не закрывать в main до merge |
| Q0-02 INGESTION-BOUNDED-MEMORY | AUD-005,016 | Ограничить чтение chunked тела без Content-Length и оценить sharedStrings/ZIP inflate; проверить 413 и bounded RSS при лимите 256 MiB. | M / высокий / не расширять R1-010D | NOT_STARTED |
| Q0-03 XLSX-STRICT-STRUCTURE | AUD-003,011,012,013,025,026 | Отрицательные/выходящие индексы, несовпадающие координаты, malformed relationships, int32 границы и неизвестные типы дают контролируемую parse issue; стандартные книги проходят. | M / высокий / parser→Nest/PG fixtures | NOT_STARTED |
| Q0-04 CSV-SKU-SEMANTICS | AUD-010,021,024 | Структурный delimiter detection; boolean 0/1 согласован по контракту; noncanonical scientific/hex/sign SKU не нормализуются незаметно; raw provenance сохранён. | M / высокий / не менять malware completeness policy CSV | NOT_STARTED |
| Q0-05 STAFF-SESSION-AND-FILTER-RACES | AUD-032,033 | Generation/epoch или abort; reversed response, смена фильтра, logout/login другого пользователя не применяют старые данные. | S–M / высокий / сохранить cookies/CSRF/session revocation | NOT_STARTED |
| Q0-06 DOWNLOAD-ABORT-LIFECYCLE | AUD-030 | Реальный HTTP abort/close освобождает stream/FD; RBAC, CLEAN eligibility и audit остаются неизменны. | S / высокий / блокируется пересечением с PR #28 | BLOCKED_BY_DEPENDENCY |

## Q1 — функциональная корректность

| Пакет | Findings | DoD / зависимость | Effort / риск | Статус |
|---|---|---|---|---|
| Q1-07 SUPPLIER-CURSOR-SORT | AUD-014,019 | ASC/DESC согласованы с lexicographic cursor; tie timestamps, invalid cursor 400, стабильный обход страниц. | S–M / средний | NOT_STARTED |
| Q1-08 STAFF-LIST-PAGINATION | AUD-015 | Seed >100 категорий/брендов/импортов и >50 поставщиков; полный обход без пропусков при сохранении permission checks. | M / средний | NOT_STARTED |
| Q1-09 RFQ-UNKNOWN-CREATE-RECOVERY | AUD-002 | UX решения владельца после полного reload; без localStorage capability/PII; тесты SPA/reload/back/full navigation. | M / высокий | OWNER_DECISION_REQUIRED |
| Q1-10 CATALOG-NEGATIVE-LOOKUP | AUD-031 | Ограниченный backend lookup и замеры на 1k/10k категорий; не менять frozen catalog contract без отдельного согласования. | M / высокий | NOT_STARTED; contract gate |

## Q2 — только после baseline

| Пакет | Findings | Перед изменением | DoD | Статус |
|---|---|---|---|---|
| Q2-11 IMPORT-PERFORMANCE | AUD-004,018,022,023,028 | 1k/10k/20k строк; query count, p50/p95, lock latency, RSS/CPU и failure semantics. | Сравнимый baseline→after без потери prevalidation, idempotency, audit и OCC. | PERFORMANCE_NEEDS_BASELINE |
| Q2-12 STAFF-AUTH-AND-PRODUCTION-CONFIG | AUD-017,020 | 20–50 параллельных GET, revoke/logout race, remote HTTPS browser acceptance. | Нет auth regressions; prod config fail-fast, без loopback fallback. | PERFORMANCE_NEEDS_BASELINE |

## Q3 — поддерживаемость и UX

| Пакет | Findings | Ограничение | Статус |
|---|---|---|---|
| Q3-13 TYPED-PROJECTIONS-AND-CLIENT | AUD-007,027,035 | Один экран/DTO за PR; DTO equivalence tests; без массового рефакторинга. | NOT_STARTED |
| Q3-14 README-CI-HYGIENE | AUD-008,009 | Проверенная action revision/SHA, актуальный README, CI повторно PASS. | NOT_STARTED |
| Q3-15 BRAND-FACETS-UX | AUD-034 | Требуется решение владельца: глобальные facets либо явно описанное ограничение текущей страницы. | OWNER_DECISION_REQUIRED |

## Следующие выгодные независимые пакеты

1. **Q0-03** — устраняет некорректное чтение malformed XLSX на parser boundary; effort M, риск M; нужны negative fixtures и parser→Nest/PG checks.
2. **Q0-04** — защищает исходные CSV-значения SKU/boolean от скрытой нормализации; effort M, риск M; нужны cross-runtime fixtures и provenance round-trip.
3. **Q0-02** — закрывает чтение тела до size gate и измеряет XML/ZIP amplification; effort M–L, риск H; нужен isolated resource-limited runtime, не менять R1-010D.

Это только рекомендация следующего цикла; код этих пакетов не создавался.

## Historical Q0-03 source — complete preserved snapshot

Source main `4c0d2f7310f7040091de38b76ed992449b18b539`, Git blob `65fd68eae58ba1dabdef1c4e422f1c83d1ace5e0`. Detailed Q0-04 evidence remains in `Q0-04/` and its [post-merge handoff](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38#issuecomment-6600830728).

# QUALITY-2026-Q4 — план исправлений

Пакеты отделены по ownership. Q0-03 завершает документационную гигиену в PR #35. Q0-04 отдельно авторизован владельцем и ведётся в самостоятельной ветке; Q0-02 и Q0-05 не начинать.

| Пакет | Findings | Минимальное изменение / DoD | Риск и зависимости | Статус |
|---|---|---|---|---|
| Q0-01 | AUD-029 | Сохранить browser idempotency key/body hash при неопределённом ответе; реальный Staff UI/API/PG response-drop acceptance. | Средний; frozen supplier API и server idempotency сохранены. | Draft PR #30; exact-head CI для `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3` прошёл, run #41429744152. Не merge-ить. |
| Q0-03 | AUD-003/011/012/013/025/026 | Строгие XLSX индексы/relationship/координаты/cell types; HTTP preflight и parser→Nest→disposable PG регрессии; стандартные поддержанные типы и sparse структуры сохраняются. | Средний; нет схемы/API/auth/permission изменений. | Draft PR #35 открыт. Независимый review PASS; latest verified exact-head CI run #160 на `b1c17e1` прошёл. Документационный follow-up требует проверки своего pushed SHA; merge запрещён. |
| Q0-02 | AUD-005/016 | Bounded ingestion memory/resource use with parser and disposable-runtime acceptance. | Высокий; ограничить память без расширения импорта или изменения контрактов. | NOT STARTED; не входит в текущую авторизацию. |
| Q0-04 | AUD-010/021/024 | CSV delimiter semantics, XLSX Boolean typing, and SKU identity semantics with parser→Nest acceptance. | Высокий риск исходных товарных данных; сначала сверить контракты и допустимую грамматику SKU. | Отдельно авторизован; отдельная ветка от свежего `origin/main`, Draft PR, `REVIEW_REQUIRED`, без merge. |
| Q0-05 | AUD-032/033 | Staff UI race conditions and browser acceptance. | Средний/высокий auth UI риск. | NOT STARTED; не входит в текущую авторизацию. |

## Q0-03 детали

1. Стиль/shared-string индексы: проверять lexical form, неотрицательность и верхнюю границу; не молча подменять несуществующий style.
2. Координаты: проверять положительный int32 row index, row/cell row equality и дубликаты; не вводить запрет на sparse или необычный порядок строк/ячеек.
3. Relationships: требовать Id/Type/Target, уникальные Id, internal safe target и существующую часть; worksheet принимается только с точным worksheet relationship type и реальным worksheet root/`sheetData`.
4. Cell types: применять существующую allowlist до ветки formula; сохранить результаты для поддерживаемых типов и отклонить `d`/unknown.
5. Ошибки: только typed `ImportParseError`; не добавлять широкий catch. FastAPI preflight должен завершиться до NDJSON response; API transaction не должен оставить source/run/rows для невалидного XLSX.

Исключения: не исправлять AUD-005/016 resource-budget вопросы, AUD-010/021/024/030, R1-010D/CLEAN, supplier/auth/UI, контрактные файлы, миграции или production.
