# R1-004A — пакет решений владельца OD-004A

**Статус: PROPOSED / REVIEW_REQUIRED. Пакет контракта: 0.1.0-proposed.** Основание — задача R1-004A и перечисленные в ней нормативные документы. Решения #1–108 и FROZEN R1-002 1.0.0 не меняются. Отметка «рекомендуется» не считается утверждением до явного ответа владельца.

## OD-004A-01 — идентичность CatalogProduct

**Рекомендуется:** идентичность — отдельный бренд + manufacturer name + original manufacturer part number + modification. Точная регистрозависимая идентичность после NFC и обрезки внешних пробелов; регистр, дефисы, внутренние пробелы и пунктуация не схлопываются. `NULL` modification — отсутствие модификации. Уникальность работает только при заполненных brand/manufacturer/original part number. Бренд и производитель остаются разными полями. После первой отправки identity tuple неизменяем; дубликат получает `IDENTITY_CONFLICT`, без merge/аналога.

**Альтернативы:** регистронезависимое сопоставление/нормализация пунктуации; уникальность только артикула; редактирование идентичности после публикации.

**Последствия:** строгое правило снижает риск ошибочного склеивания разных SKU, но может оставить разные карточки для одного артикула с отличающимся регистром/форматированием; ручное расследование дубликата остаётся за сотрудником. Редактирование после первой отправки потребовало бы отдельной версии identity и миграции связей SupplierOffer, которых пока нет.

## OD-004A-02 — публикация и изменение опубликованного товара

**Рекомендуется:** стабильный product root плюс неизменяемые revisions. Каждое сохранение draft добавляет новый snapshot; при замене текущего draft транзакция под root lock временно очищает pointer, переводит прежний draft в терминальный `SUPERSEDED`, вставляет новую draft revision и устанавливает новый pointer. Deferred workflow guard проверяет pointer/state согласованность на commit; partial unique indexes сохраняют максимум один draft и один pending revision. PATCH требует `baseRevisionId`: при текущем draft это его ID; после успешного submit edits блокируются до решения; при отсутствии draft/pending основой становится самый новый `RETURNED`/`REJECTED`, созданный после текущей опубликованной редакции, иначе текущая published revision; у ещё не опубликованного товара — последний `RETURNED`/`REJECTED`. Старый или произвольный base получает `VERSION_CONFLICT`. Это даёт путь новой редакции и после первой публикации, и после возврата/отказа, не меняя старые snapshots. Публичный API читает только текущий `publishedRevisionId`; pending/returned/rejected edits не меняют опубликованную карточку. Review имеет три явных исхода: `PUBLISH`, `RETURN_FOR_CHANGES` (terminal revision, из неё можно начать следующий draft), `REJECT` (terminal revision, из неё также можно начать новый draft). Архив — терминальная команда, которая отменяет pending revision и отзывает public pointer без удаления истории.

Разрешения write/submit/publish/archive раздельны. Исходные решения не задают запрета self-review; рекомендуется не вводить отдельную двухперсонную политику: один сотрудник может выполнить submit и publish только при наличии обеих независимых permissions. Любая публикация фиксирует reviewer, UTC time, revision/version и audit transaction.

По обязательному CAT-03 публичная детальная карточка также показывает только вручную созданные связи `ACCESSORY`/`COMPATIBLE_EQUIPMENT`. Целевой товар выдаётся безопасным карточным DTO по slug лишь пока он активен и его текущая опубликованная редакция совпадает с закреплённой; при расхождении связь скрывается, без автоматической перепривязки. Ни один тип связи не означает функциональный аналог или замену.

**Альтернатива:** mutable draft + JSON published snapshot; либо запрещать редактирование до отдельного дубля товара. Snapshot отдельными редакциями добавляет строки и требует OCC, но сохраняет старую карточку и полную ручную историю без перезаписи.

## OD-004A-03 — атрибуты и категории

**Рекомендуется:** typed definitions `TEXT/DECIMAL/INTEGER/BOOLEAN/ENUM`, одна definition принадлежит одной конкретной категории, без неявного наследования от parent. Значение одно на definition/revision, typed columns + DB CHECK + composite FK category/type и серверная валидация. Wire contract discriminates by `valueType`; API сверяет заявленный тип с найденной `AttributeDefinition`. TEXT ограничен 240 Unicode characters; DECIMAL — canonical base-10 string <=64 chars без exponent/leading plus or zeroes/trailing fractional zeroes/negative zero; INTEGER — JSON safe integer; ENUM — существующий code. У каждой numeric definition один display unit; automatic conversion и multi-value attributes не входят.

Code/type/unit/options и фильтрующие флаги замораживаются после появления ссылок; изменение смысла — новое definition code. `label` можно переименовать, потому что старый label/unit/type snapshot лежит в ProductAttributeValue. Slugs вводятся сотрудником и уникальны глобально.

**Альтернативы:** атрибуты наследуются по дереву; M:N mapping таблица; JSON-only values; автоматический конвертер физических единиц.

**Последствия:** точная category scope сокращает неоднозначность фильтра и схему; повторно используемое поле может иметь отдельные definitions в нескольких категориях. Изменение структуры свойств остаётся явным и versioned.

## OD-004A-04 — permissions каталога

**Рекомендуется утвердить ровно 12 новых actions:** `catalog.references.read`, `catalog.products.read`, `catalog.products.write`, `catalog.products.submit`, `catalog.products.publish`, `catalog.products.archive`, `catalog.categories.write`, `catalog.brands.write`, `catalog.attributes.write`, `catalog.products.relations.write`, `catalog.products.media.write`, `catalog.products.documents.write`.

Ни один каталоговый action не включается в R1-002 protected base set или существующие role templates. Нет `catalog.admin`, wildcard или привязки к имени роли. Для файлов metadata permissions каталога дополняются существующими `files.metadata.read` и точной R1-002 object policy.

**Последствия:** granular actions могут назначаться объединением нескольких обычных ролей; ни один существующий доступ не расширяется при применении migration.

## OD-004A-05 — первое предоставление catalog permissions

**Рекомендуется:** migration только добавляет Permission registry rows, все unassigned. После отдельного owner decision оператор один раз запускает локальный CLI `catalog:permissions:initialize`, указывая target user, approval reference и operator label. Approval reference — обязательная внешняя ticket/reference метка длиной 1..80, pattern `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$`, без секретов/PII; это сохранённая строка ручного процесса, а не доказательство решения. Target должен иметь ACTIVE state, завершённый пароль, рабочие RBAC-management actions; CLI назначает target только exact pinned 12-code permission set этого контракта и fail-closed отказывается, если registry содержит другой набор. Изменение набора допускается только через отдельный approved contract update. Команда не меняет готовые роли, не запускается CI/startup/deploy, не доступна по HTTP, не повторяется после успешной append-only audit записи. Любое действие выполняется в одной транзакции под тем же lock `1398031445,2`, с повторной проверкой frozen control-admin/full-admin инвариантов. Далее обычное делегирование идёт через R1-002 RBAC API с существующим grant ceiling.

**Альтернативы:** временно включать permissions в bootstrap-admin (отклонено — автоматическая выдача); просить владельца вручную редактировать SQL (нет аудируемого приложения); ослабить grant ceiling (отклонено).

**Операционный риск:** при потере всех catalog permissions повторное provision потребует нового явно утверждённого recovery решения. Permission loss не исправляется автоматическим bootstrap.

## OD-004A-06 — публичный search/filter/pagination

**Рекомендуется:** GET list с `categorySlug`, `includeDescendants=true`, `brandSlug`, `q`, повторяемыми `filter`, `page`, `pageSize`, `sort`. `page` 1..10000, `pageSize` 1..100 (default 24). `q` — literal case-insensitive substring (не regex/SQL), максимум 128 chars, по опубликованным displayName, brand, manufacturer, original part number, modification и атрибутам со snapshot `searchable=true`; пустая строка `q` принимается и нормализуется как отсутствие текстового фильтра. Порядок по умолчанию `name_asc`, tie-break `slug ASC`; другие сортировки только `name_asc`, `name_desc`, `brand_asc`, `part_number_asc`. Детальная карточка по CAT-03 включает description, сравнимые атрибуты и действующие ручные accessory/compatible relations; summary/search card их не раскрывает.

Каждый filter имеет формат `filter=<attributeCode>:<op>:<value>`, значение URL-decoded после первых двух разделителей. Поиск по категории с `includeDescendants=true` разрешён без технических фильтров. Если передан хотя бы один `filter`, обязательны `categorySlug` и явно переданный `includeDescendants=false`. Технический фильтр с `includeDescendants=true` или отсутствующим `includeDescendants` (default `true`), а также без `categorySlug`, возвращает `400 VALIDATION_ERROR` до запроса к БД. Фильтр применяется только к точной выбранной категории и её отдельным AttributeDefinition, без наследования; definition должен быть filterable и active at revision snapshot. Атрибуты разных категорий не сопоставляются автоматически по одинаковому `code`. `eq` поддерживается всеми типами, `contains` — TEXT, `gte/lte` — DECIMAL/INTEGER, `true/false` — BOOLEAN, ENUM — code equality. Разные filters AND; одинаковая пара code/op повторена — `VALIDATION_ERROR`. Decimal uses canonical base-10 string without exponent; server never interpolates a query identifier into SQL.

**Альтернативы:** opaque cursor, полнотекстовый ranked search, API accepts SQL-like filter grammar.

**Последствия:** offset paging прост и URL-shareable, но глубокие страницы дороже и при параллельной публикации возможен сдвиг результата; стабильный tie-break ограничивает недетерминизм. Ranking/typo-tolerance остаются поисковой функцией R1-005 и не входят в контракт.

## OD-004A-07 — файлы и публичные документы

**Рекомендуется:** media/document metadata versioned with ProductRevision and FK to exact R1-002 FileVersion. FK is not access. No upload/download endpoint, raw key, file ID, or public URL. Under current frozen contract every FileVersion is `UNCHECKED`, and FileObject is `PRIVATE|INTERNAL`; Public DTO therefore includes no media/documents fields in R1-004B. Public inclusion is added only after separate approved safe-file delivery contract/scanning capability; never by relaxing `FileVersion` ACL implicitly.

**Альтернатива:** include public links now (отклонено — нет checked/public state и delivery path).

**Последствия:** R1-005 may implement catalogue rendering before product files are displayable; file/card imagery must remain absent until safe delivery exists. The R1-005 dependency/acceptance plan must explicitly include that safety gate before CAT-03 file display is considered complete.

## OD-004A-08 — цена по запросу

**Рекомендуется:** не создавать цену в CatalogProduct и не хранить последний прайс в этом контракте. R1-004B public DTO всегда возвращает `{kind:"ON_REQUEST",label:"Цена по запросу"}`. Stale, absent or unapproved source maps to same state; no guessed/last-known amount. `CONFIRMED` price data shape and source rules are intentionally delegated to R1-007/R1-009 contract after their approved inputs exist.

**Последствия:** R1-005 safely displays the configured request label; price amount requires the future source-and-freshness workflow, not a Catalog fallback.

## OD-004A-09 — immediate taxonomy visibility

**Рекомендуется:** Brand/Category/AttributeDefinition use `ACTIVE|ARCHIVED`; no extra category approval state is added because none is specified. Category and brand create/rename/reparent operations are immediate, server-authorized and audited; public category navigation returns only ACTIVE categories under the bounded direct-child contract in OD-004A-10. Product content remains read from immutable published revision, while public brand/category display names come from current ACTIVE references so immediate rename is visible without rewriting revision history; stable slugs do not change. Category reparent operations use a serialized recursive cycle check. Product/category slugs are globally unique and not reused; product slug immutable after first submit. Category archive is rejected while it has an active child or a non-archived product current draft, pending or published pointer uses it; non-current returned/rejected/superseded and other historical revisions do not block archive. Brand archive is rejected while a non-archived product root identity uses it. Archive checks repeat under the same reference/tree locks as writes.

**Альтернатива:** separate draft/approve/publish workflow for every reference record.

**Последствия:** a staff member with the corresponding reference permission can change public navigation/brand labels immediately. Adding a second approval workflow would be a new business gate and is not inferred.

## OD-004A-10 — публичная навигация по категориям

**Рекомендуется (выбор интерфейса подтверждён владельцем):** `GET /v1/public/catalog/categories` возвращает только ACTIVE прямых детей. Без `parentSlug` это корневые категории; с `parentSlug` — дети точного ACTIVE родителя. Неизвестный и архивный `parentSlug` дают одинаковый 404. Результат имеет `pageSize` 1..100 (default 24), порядок `sortOrder ASC, slug ASC`, optional keyset cursor по `(sortOrder, slug)`, не более одной страницы и одного уровня на ответ. Opaque unpadded base64url cursor кодирует последний выданный ключ; `meta.nextCursor` — следующий cursor или `null`, полный `total` не вычисляется. Номер страницы и верхний предел количества категорий отсутствуют. Клиент строит дерево последовательными запросами. Новый маршрут или глобальный лимит глубины категорий не добавляется.

**Альтернативы:** рекурсивно отдавать всё дерево; вводить глобальный максимум числа/глубины категорий.

**Последствия:** размер отдельного публичного ответа ограничен, а каталог не получает произвольного глобального ограничения на число категорий или номер страницы. UI должен загружать прямых детей курсорами и строить навигационное дерево на клиенте. R1-004B проверяет предел страницы, продолжение за пределом обычных page numbers и отсутствие recursive DTO; R1-005 использует постраничные запросы при построении навигации.

## OD-004A-11 — фильтры staff списка товаров

**Выбор владельца подтверждён:** `publicationState=DRAFT|PENDING_REVIEW|PUBLISHED` фильтрует по соответствующему текущему pointer продукта: `currentDraftRevisionId`, `pendingRevisionId` или `publishedRevisionId`. `ARCHIVED` проверяет корневой `CatalogProduct.publicationState`. Если `categoryId` задан вместе с состоянием DRAFT/PENDING_REVIEW/PUBLISHED, категория должна совпадать с редакцией, выбранной тем же pointer. Без `publicationState` категория должна совпасть с любым существующим текущим draft/pending/published pointer. Комбинация `ARCHIVED + categoryId` отклоняется с `VALIDATION_ERROR`, поскольку терминальная архивация очищает все current pointers. Исторические редакции, не выбранные существующими pointers, не влияют на фильтр.

**Последствия:** список может содержать один и тот же root в отдельных запросах по разным workflow-state, если у продукта одновременно сохранены опубликованная редакция и редакция на проверке/черновик. Фильтры отражают выбранные текущие рабочие редакции и не интерпретируют агрегатное root state как замену revision state.

## Формат утверждения пакета

После независимых Backend/Database/Security reviews и устранения HIGH/MEDIUM замечаний владелец может утвердить единый набор:

> Утверждаю R1-004A Catalog Domain Contract 0.1.0-proposed по OD-004A-01…11 на точном SHA `<PR_HEAD_SHA>`. FROZEN R1-002 1.0.0 и решения #1–108 не меняются. Разрешаю ограниченную реализацию R1-004B в пределах контрактного PR; production migrations/operations этим утверждением не разрешаются.

Любое частичное/изменённое решение следует перечислить по OD ID. Утверждение распространяется на ровно те файлы/дифф, которые находятся в указанном PR SHA; оно не санкционирует merge до выполнения Git Delivery Policy checks.
