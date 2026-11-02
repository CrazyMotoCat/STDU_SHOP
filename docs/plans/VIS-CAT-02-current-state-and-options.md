# VIS-CAT-02 — текущее состояние и варианты архитектуры

**Статус:** DRAFT / REVIEW_REQUIRED / NOT FROZEN<br>
**Основание:** origin/main 336ec8ed82224748e8d2b76bd9a049ee7fb38fbb<br>
**Область:** архитектура фотографий публичного каталога; без runtime-изменений, миграций и изменения frozen-контрактов.<br>
**VIS-CAT-01:** PR #32 (747f390244e7965044d53c657d7e211997609826) остаётся отдельным Draft PR и в эту ветку не включён.<br>

## Решение в двух строках

Рекомендуется оставить ProductMedia источником истины о связи фотографии с редакцией товара и использовать существующие FileObject/FileVersion для неизменяемого оригинала и производных файлов. Выдавать только производные файлы через новый узкий публичный NestJS-маршрут, который каждый раз проверяет активность товара, текущую опубликованную редакцию и связь media с ней.

Физическое хранилище остаётся закрытым private-files volume, доступным только API. Никаких статических публичных файлов, публичного FileVersion ID, storage key или общего download endpoint. Отдельная ProductMediaAsset не нужна. Изолированный image worker обоснован как граница недоверенного декодера; очередь и брокер для MVP не нужны.

## Что подтверждено в исходниках

| Область           | Текущее состояние                                                                                                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Файлы             | FileObject — логическая запись с владельцем и visibility PRIVATE/INTERNAL. FileVersion — неизменяемая версия с opaque storageKey, SHA-256, размером и MIME; safetyState сейчас только UNCHECKED.                                                   |
| Хранение          | StoragePort предоставляет write/open и требует от вызывающего доменную авторизацию. PrivateFileStorage использует случайные ключи и атомарную запись. ADR-004 запрещает public/static mount; private-files volume смонтирован только в NestJS API. |
| Связь с каталогом | ProductMedia принадлежит CatalogProductRevision и ссылается на точный FileVersion ID. Содержит altText, caption, sortOrder, isPrimary, createdBy/At. FK не является ACL.                                                                           |
| Staff API         | GET/PUT метаданных ProductMedia существуют. PUT заменяет только метаданные на draft revision; проверяет catalog.products.media.write и files.metadata.read с object-level доступом. Загрузки изображения, preview/download и публичной выдачи нет. |
| Upload pattern    | Catalog import умеет отдельную приватную загрузку с лимитом 10 MiB, idempotency и записью FileObject/FileVersion. Это специализированный импортный workflow; его разрешение и файлы нельзя автоматически использовать для ProductMedia.            |
| Product workflow  | CatalogProduct указывает на опубликованную редакцию отдельным publishedRevisionId. Изменения создают следующую редакцию; публикация переключает pointer транзакционно. Архивирование скрывает товар. ProductMedia живёт в конкретной редакции.     |
| Public API        | Поиск и карточка товара читают только активный товар и его publishedRevisionId. PublicCard сейчас не содержит изображения; DTO не раскрывает media, FileVersion ID или storageKey.                                                                 |
| Frontend          | Каталожный UI получает API-ответ через серверный API_INTERNAL_URL и сейчас показывает fallback без изображения. Remote image hosts не настроены. Web контейнер не имеет private-files volume.                                                      |

Подтверждающие источники:

- apps/api/prisma/schema.prisma — FileObject, FileVersion, CatalogProduct, CatalogProductRevision, ProductMedia.
- apps/api/src/catalog/catalog.controller.ts — staff GET/PUT media и public product routes.
- apps/api/src/catalog/catalog.product.service.ts — listProductMedia, replaceProductMedia, fileAccessible, publicCard, getPublicProduct/searchPublicProducts.
- apps/api/src/storage/storage.port.ts и private-file-storage.ts.
- apps/web/src/lib/catalog/api.ts и apps/web/src/components/catalog/catalog-ui.tsx.
- docs/adr/ADR-004-file-storage.md.
- docs/contracts/R1-002-staff-data-model.md, R1-004-catalog-data-model.md, R1-004-catalog-rbac-matrix.md и соответствующие JSON/OpenAPI fixtures.

## Архитектурная граница

    Staff browser
       │ authenticated upload + CSRF + idempotency
       ▼
    NestJS catalog API ──► private staging in private-files volume
       │                           │ bounded stream
       │                           ▼
        │                    isolated media worker
        │                    no DB / no storage mount / deny-egress verified at deployment
       │                           │ re-encoded derivatives
       ▼                           ▼
    PostgreSQL: FileObject/FileVersion + CatalogMediaIngestion + ProductMedia
       │
       ├── staff preview: scoped authorization, derivative only
       └── public GET: current product pointer + ProductMedia + READY rendition check
                         │
                         └── only a re-encoded derivative streams from the private volume

Private original bytes and derivative bytes remain private at rest. “Public” means the application may stream an eligible derivative after a publication check; it does not mean the object or volume is publicly addressable.

## Сравнение вариантов

| Критерий                | A — расширить существующие FileObject/FileVersion + ProductMedia                                                                                                                           | B — отдельная ProductMediaAsset                                                                                                     | C — отдельное хранилище публичных derivatives                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Схема                   | Существующие FileObject/FileVersion остаются реестром байтов. ProductMedia остаётся связью с точной редакцией. Additive ingestion/rendition metadata и provenance.                         | Новая media-asset identity, свои версии/состояния/ACL, плюс связь с ProductMedia или замена её роли.                                | Существующие ProductMedia остаются связью с редакцией; добавляется карта производных объектов и отдельное storage namespace/root.         |
| API                     | Узкий staff upload/preview и public stream endpoint. Текущие публичные product DTO дополняются безопасными rendition metadata.                                                             | Отдельные API для asset lifecycle плюс синхронизация с ProductMedia и files.                                                        | Upload/process в API; после публикации API отдаёт прямой URL либо proxy/auth-check для отдельного хранилища.                              |
| StoragePort             | Минимальное расширение staging/reconciliation. Оригиналы и derivatives — FileVersion в private volume с закрытыми media-only namespaces. API делает open только после предметной проверки. | Потребуется второй file/content abstraction или адаптер к FileObject; иначе asset всё равно обёртывает FileVersion и дублирует его. | Новый scoped derivative store/namespace; синхронизация байтов между БД и storage, backup/restore и очистка отдельно от FileVersion.       |
| Безопасность            | Самая короткая цепочка до действующих ACL и закрытого storage. Публичный endpoint не принимает FileVersion ID/key. Декодер вынесен в ограниченный worker.                                  | Дополнительная ACL и состояния создают риск обхода существующего файлового permission gate и дублирующих ссылок.                    | Хорошее физическое разделение оригинала и output. Прямой static route, однако, усложняет проверку текущей публикации и отзыв.             |
| Права                   | Добавляются отдельные media upload, preview и emergency revoke permissions; текущие catalog/file grants автоматически не расширяются.                                                      | Помимо media permissions нужны правила для второго каталога assets и согласование ролей.                                            | Upload/revoke permissions остаются; надо добавить операторские права storage publication/purge и безопасно связывать их с product review. |
| Производительность      | Варианты создаются один раз при upload; public GET делает bounded DB lookup и потоковую выдачу файла. Нет resize на GET. Пригодность одного VDS надо подтвердить fixture/load tests.       | Примерно как A после реализации; отдельная сущность сама по себе не ускоряет выдачу.                                                | Лучший потенциал на статической раздаче, меньшая нагрузка на API. Выигрыш нужен только после измерения трафика.                           |
| Хранение и эксплуатация | Одна существующая volume и backup цепочка; ориентировочно 1 оригинал + 4 derivatives на фото. Умеренная сложность, добавляются ingestion и worker.                                         | Больше таблиц, связей, правил архивирования, восстановления и миграций. Высокая стоимость сопровождения.                            | Ещё одна namespace/volume и процедура backup/restore; прямой доступ и purge требуют reverse-proxy настроек. Средне-высокая стоимость.     |
| Совместимость           | Аддитивное расширение, но публичные FileVersion и visibility PUBLIC не вводятся. Требуется новая утверждённая версия R1-002/R1-004.                                                        | Новая модель меняет утверждённую архитектуру каталога и повторяет уже имеющийся ProductMedia.                                       | Не меняет оригинальный FileObject, но требует новой delivery/storage границы и contract для version/revoke/cache.                         |
| Rollback                | Отключить media routes/DTO output, вернуть fallback. Аддитивные таблицы и приватные FileVersions оставить; destructive down не делать.                                                     | Для rollback придётся синхронизировать две модели и историю каждой ProductMedia-связи.                                              | Остановить direct route и оставить files; удалять volume нельзя. Старые browser/CDN copies отозвать мгновенно невозможно.                 |

### Оценка объёма хранения

Для A и B базовый объём одинаков: source плюс заранее созданные derivatives. Для C source остаётся в private volume, а опубликованные derivatives переходят в отдельный storage tier с собственной резервной копией и очисткой. Для ориентира, при условных 1,000 фото × (1.5 MiB source + 0.7 MiB суммарных variants) это около 2.2 GiB primary media bytes; одна полная backup copy добавит ещё около 2.2 GiB. Это оценка данных, а не цена провайдера или VDS; для C надо отдельно учитывать storage/backup overhead и не считать копию заменой private source.

### Почему вариант B отклонён

ProductMedia уже является редакционно-версионной связью, а FileVersion уже является неизменяемой ссылкой на конкретные байты. Новая ProductMediaAsset, если хранит те же source version, owner, digest, state и product link, дублирует два существующих источника истины. Для загрузки нужен pipeline-operation record и таблица renditions; они не являются второй сущностью фотографии: ingestion отвечает только за обработку/идемпотентность source FileVersion, ProductMedia — за товарную связь, ProductMediaRendition — за производный output. Новая asset-сущность может быть пересмотрена только если появится одобренная потребность в asset-library вне редакций товара или отдельной независимой публикации.

### Почему вариант C не выбран для MVP

У текущей архитектуры уже есть private volume на одном VDS и правило «API-only access». Public/static namespace снизит нагрузку на API, но потребует нового reverse-proxy и purge контракта, отдельного backup/restore, reconciliation между транзакционной БД и файловой копией и принятия остаточного cache window при отзыве. При малом стартовом объёме заранее доказанного выигрыша нет. C остаётся fallback после измерения throughput/egress; безопаснее сначала оставить route gating в API.

## Рекомендуемое решение

**Выбрать A:** использовать FileObject/FileVersion и ProductMedia как авторитетные сущности. Additive R1-002/R1-004 amendment вводит scoped upload processing, provenance и mapping безопасных производных вариантов. До реализации владелец утверждает media-specific quarantine/safety policy; изолированный worker декодирует и заново кодирует изображение, а scanner подключается только если его необходимость и ресурсы подтверждены. Оригинал и производные лежат в существующем private-files volume, в закрытых namespaces. NestJS публично стримит только rendition после проверки active product → active category/brand → exact published revision → ProductMedia exact source → READY ingestion/rendition. Public DTO содержит только public media reference, alt text, dimensions и безопасные rendition descriptors.<br>
**Fallback:** C-подобное отдельное derivative namespace, если нагрузочная проба подтвердит, что API streaming мешает сайту. Оно должно оставаться за reverse proxy с проверкой опубликованной связи либо иметь небольшой TTL и утверждённый revoke/purge режим. Статический URL нельзя считать ACL и нельзя обещать мгновенное удаление закэшированной копии.<br>
