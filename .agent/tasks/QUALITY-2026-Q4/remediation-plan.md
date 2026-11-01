# QUALITY-2026-Q4 — план исправлений

Пакеты независимы; отдельный PR на пакет. В рамках текущего разрешения реализуется только Q0-01. Другие пакеты не начинать автоматически.

## Q0 — корректность, безопасность, надёжность

| Пакет | Findings | Минимальное изменение и DoD | Effort / риск / зависимости | Статус |
|---|---|---|---|---|
| Q0-01 STAFF-SUPPLIER-IDEMPOTENCY | AUD-029 | Один key/body в пределах логической операции; single-flight; same-body retry после transport failure/reload; changed-body не переиспользует ключ молча; реальный API+PG commit/response-drop/replay с одной supplier, revision, audit receipt и одной offer записью. | S–M / средний / без изменения API и БД | Реализован локально; Draft PR/CI pending |
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