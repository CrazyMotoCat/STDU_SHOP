# QUALITY-2026-Q4 — перепроверка findings для Q0-03

Перепроверка выполнена на `origin/main` `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. Исходные reproductions были синтетическими; они не доказывали production-инцидент или потерю данных. Исправления ограничены XLSX ingestion и не меняют frozen contracts.

| Finding | Исходное подтверждение и root cause | Результат Q0-03 | Доказательство и граница |
|---|---|---|---|
| AUD-003 P2 | `catalog_import_parser.py`: Python indexing принимал отрицательные shared-string и style индексы; положительный style за концом массива молча превращался в `General`. | `FIXED` — синтаксическая проверка неотрицательности и явная верхняя граница до indexing. | RED фикстуры `s=-1`, `s=1` вне списка, `style=-1`, `style=2`; GREEN parser tests. Ошибка возвращает `FILE_REJECTED`. Нет заявления о ранее повреждённых production-данных. |
| AUD-011 P2 | Парсер извлекал номер строки из `row@r`, а `cell@r` использовал только для номера столбца; row component не сравнивался. Дубликаты source coordinates не выявлялись в XLSX. | `FIXED` — полная координата ячейки сверяется со строкой; дубликаты row/cell отклоняются, нулевые/отрицательные/overflow координаты контролируются. | RED `row r=3`, `cell A4`, duplicate cells и duplicate rows; GREEN sparse/out-of-order строки и ячейки принимаются и сохраняют порядок XML. HTTP поздней ошибки возвращает JSON 415 без NDJSON. |
| AUD-012 P2 | `_sheet_targets` индексировал `rel.attrib["Id"]`; отсутствующий атрибут поднимал неперехваченный `KeyError`. Исходный аудит не установил HTTP-результат. | `FIXED` — обязательные relationship атрибуты проверяются, ошибки типизированы через `ImportParseError`; проверена package→workbook связь и дубликаты ID. | RED missing-Id relationship; GREEN прямой parser и FastAPI `TestClient`: HTTP 415 `{ "code": "FILE_REJECTED" }`, не NDJSON. Это закрывает parser path; production-сценарий не заявляется. |
| AUD-013 P2 | Python `int` принимал положительный `sourceRowNumber` выше PostgreSQL signed `integer`; Nest staging использует PostgreSQL `integer`. DB/HTTP failure в исходном аудите не воспроизводились. | `FIXED` — row и cell reference ограничены `1..2_147_483_647` до staging. | RED `2_147_483_648`; GREEN максимальное значение принимается. Disposable API+PostgreSQL upload с поздней строкой `2_147_483_648` отклонён; run/file object/import rows не сохранены, sentinel БД сохранён. |
| AUD-025 P3 | Неизвестный `cell@t` проходил в ветку `NUMBER`; allowlist был объявлен, но не применялся. | `FIXED` — allowlist `n`, `s`, `inlineStr`, `b`, `str`, `e` проверяется до обработки formula/value; неизвестный тип и `d` отклоняются. | RED неизвестные `z`/`d`, включая formula cells. GREEN отображение поддержанных типов, формулы и blank проверено fixtures. `d` намеренно не добавлен в поддержку. |
| AUD-026 P3 | Relationship target выбирался по `Id`, а relationship `Type` не проверялся; путь также надо разрешать относительно part, содержащего relationship. | `FIXED` — точный `.../worksheet` Type, source-relative internal target resolution, проверка traversal/существования ZIP part. Styles/sharedStrings также выбираются только по workbook relationship type. | RED wrong-Type, traversal и target collision фикстуры; GREEN выбирает part по OPC source-relative URI даже при конфликтующем каноническом ZIP entry. Wrong Type даёт typed parser error/HTTP 415. OPC target resolution: [Packagerelationship.TargetUri](https://learn.microsoft.com/en-us/dotnet/api/system.io.packaging.packagerelationship.targeturi?view=net-11.0-pp). |

## Independent review history

- Первый read-only review нашёл P2: target с префиксом `xl/` мог обойти source-relative разрешение, и parser мог прочитать stale `xl/styles.xml`/`xl/sharedStrings.xml` вместо частей, связанных workbook relationships.
- Оба исправлены и покрыты тестами: относительный путь разрешается от source part; worksheet, styles и shared strings загружаются через relationship types. Финальный read-only re-review: PASS, actionable P1/P2 не осталось. Hosted exact-head CI ещё не запускался.

## Сводка

- `FIXED`: AUD-003, AUD-011, AUD-012, AUD-013, AUD-025, AUD-026.
- Для шести findings выполнены RED/GREEN reproducers; HTTP/DB-подтверждения добавлены там, где они закрывают исходный пробел доказательств.
- Исходные статические/synthetic findings не трактуются как production-инциденты.
