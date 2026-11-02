# QUALITY-2026-Q4 — план исправлений

Пакеты отделены по ownership. В текущей задаче выполнен только Q0-03; следующий пакет автоматически не начинать.

| Пакет | Findings | Минимальное изменение / DoD | Риск и зависимости | Статус |
|---|---|---|---|---|
| Q0-01 | AUD-029 | Сохранить browser idempotency key/body hash при неопределённом ответе; реальный Staff UI/API/PG response-drop acceptance. | Средний; frozen supplier API и server idempotency сохранены. | Draft PR #30; exact-head CI для `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3` прошёл, run #41429744152. Не merge-ить. |
| Q0-03 | AUD-003/011/012/013/025/026 | Строгие XLSX индексы/relationship/координаты/cell types; HTTP preflight и parser→Nest→disposable PG регрессии; стандартные поддержанные типы и sparse структуры сохраняются. | Средний; нет схемы/API/auth/permission изменений. | Реализовано в этой ветке; независимый review и hosted CI — до закрытия. Собственный Draft PR, merge запрещён задачей. |
| Q0-02 | AUD-002/010 | Supplier/parser permission denial and audit; выделенный API/PostgreSQL gate. | Высокий; не смешивать с Q0-01. | NOT STARTED; не входит в текущую авторизацию. |
| Q0-04 | AUD-021/024 | Boolean/SKU interpretation only after a separate contract review and parser→Nest acceptance. | Высокий риск исходных товарных данных. | NOT STARTED; исключён. |
| Q0-05 | AUD-032/033 | Staff workspace response ordering/session epoch and browser acceptance. | Средний/высокий auth UI риск. | NOT STARTED; исключён. |

## Q0-03 детали

1. Стиль/shared-string индексы: проверять lexical form, неотрицательность и верхнюю границу; не молча подменять несуществующий style.
2. Координаты: проверять положительный int32 row index, row/cell row equality и дубликаты; не вводить запрет на sparse или необычный порядок строк/ячеек.
3. Relationships: требовать Id/Type/Target, уникальные Id, internal safe target и существующую часть; worksheet принимается только с точным worksheet relationship type и реальным worksheet root/`sheetData`.
4. Cell types: применять существующую allowlist до ветки formula; сохранить результаты для поддерживаемых типов и отклонить `d`/unknown.
5. Ошибки: только typed `ImportParseError`; не добавлять широкий catch. FastAPI preflight должен завершиться до NDJSON response; API transaction не должен оставить source/run/rows для невалидного XLSX.

Исключения: не исправлять AUD-005/016 resource-budget вопросы, AUD-010/021/024/030, R1-010D/CLEAN, supplier/auth/UI, контрактные файлы, миграции или production.
