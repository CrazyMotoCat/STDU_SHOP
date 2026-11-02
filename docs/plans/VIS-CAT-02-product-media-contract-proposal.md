# VIS-CAT-02 — предложение Product Media contract

**Статус:** DRAFT / REVIEW_REQUIRED / NOT FROZEN<br>
**Исходная граница:** R1-002 FileObject/FileVersion и R1-004 ProductMedia остаются авторитетными; исходные FROZEN-файлы не редактируются.<br>
**Цель:** сохранить точную связь фото с опубликованной редакцией товара и добавить минимальную проверяемую обработку/выдачу derivatives.<br>

## 1. Рекомендуемая схема

    CatalogProduct identity
       └── publishedRevisionId ──► CatalogProductRevision
                                    └── ProductMedia (exact source FileVersion,
                                        alt/order/primary + provenance confirmation)
                                           └── CatalogMediaIngestion (same product,
                                               source digest + scan/process state)
                                                └── CatalogMediaRendition (private
                                                    derivative FileVersion per size)

- FileObject/FileVersion хранят неизменяемые байты и обычные file metadata.
- ProductMedia связывает точный оригинал с точной редакцией и хранит редакционные metadata.
- CatalogMediaIngestion учитывает upload/scan/re-encode operation для одного продукта. Это не вторая сущность товара и не медиабиблиотека.
- CatalogMediaRendition связывает обработанный вариант с derivative FileVersion.
- Публичность определяется current publishedRevisionId и отдельной проверкой, а не FileObject.visibility, FileVersion.safetyState или фактом наличия URL.

R1-002 amendment также добавит закрытый enum FileVersion.storageNamespace с default scope для существующих записей и media-only scopes для source/derivative. Это только внутренний locator qualifier, не URL и не caller input. Физически все scopes остаются внутри имеющегося private-files volume; file identity, owner и digest всё ещё принадлежат FileObject/FileVersion. Временный staging — отдельный operation-scoped private namespace до создания FileVersion; его cleanup не переиспользует inquiry quarantine.

## 2. DRAFT-поправки к данным

### 2.1 CatalogMediaIngestion

Одна запись на upload operation и один source FileVersion. Поля-кандидаты:

| Поле                                                        | Назначение                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                          | Opaque staff operation id; не public media id.                                                                                                      |
| targetProductId                                             | Ограничивает upload одним product identity. Один upload нельзя молча применить к другому SKU.                                                       |
| uploadedByStaffUserId, createdAt, completedAt               | Авторство и lifecycle.                                                                                                                              |
| state                                                       | RECEIVING, STAGED, SCANNING, PROCESSING, READY, REJECTED, FAILED_RETRYABLE, EXPIRED, REVOKED. Закрытый enum, переходы проверяет backend/DB guard.   |
| sourceFileVersionId                                         | Nullable до успешного завершения; после сохранения указывает на неизменяемый private original.                                                      |
| idempotencyKeyHash, requestHash                             | Тот же ключ и то же тело возвращают тот же результат; изменённое тело даёт conflict. Сырые keys не пишутся в audit/log.                             |
| detectedMimeType, actualSizeBytes                           | Серверное определение после ограниченного stream и format parser; не доверять multipart MIME/имени.                                                 |
| scanResult, scannerVersion, signatureVersion, scannedSha256 | Nullable, если owner-approved policy не требует scanner; при его выборе результат привязан к source digest. Не R1-010D CLEAN и не право публикации. |
| processingProfile, decoderVersion                           | Воспроизводимый профиль decode/re-encode.                                                                                                           |
| safeFailureCode, attemptCount, expiresAt                    | Только bounded codes; без exception text и исходного имени в telemetry.                                                                             |

Индексы/уникальности-кандидаты: uploader + idempotency hash; unique non-null sourceFileVersionId; (state, updatedAt, id); unique `(id, sourceFileVersionId, targetProductId)` для составного FK из ProductMedia. Storage key не входит в public contract.

### 2.2 CatalogMediaRendition

Одна запись на ingestion и вариант:

- ingestionId + variant (THUMBNAIL | COMPACT | MAIN | FULL) — primary key.
- derivativeFileVersionId — FK на новый неизменяемый FileVersion в существующем private-files volume.
- publicAssetId — случайный locator, не credential и не ACL. Повторная обработка создаёт новый locator.
- width/height — положительные размеры после re-encode.
- outputMimeType — закрытый allowlist; для MVP кандидат image/webp.
- processingProfile — ограниченный код профиля.

Размер, SHA-256, storageKey и owner берутся из FileVersion, не копируются в Public DTO. Уничтожение/отзыв не hard-delete строки; меняется состояние ingestion с audit.

### 2.3 Additive-поля ProductMedia

Сохранить revision/fileVersion/altText/caption/sortOrder/isPrimary и добавить:

- catalogMediaIngestionId — доказывает, что source прошёл media pipeline.
- sourceType: OWN_PHOTO | MANUFACTURER | SUPPLIER | STAFF_CREATED | OTHER_REVIEWED.
- sourceReference — bounded staff-only reference (URL/номер разрешения/ticket); не скачивать по URL и не показывать клиенту автоматически.
- rightsBasis — закрытое перечисление документированного основания; точные коды согласовать с владельцем.
- rightsRestrictions и requiredAttribution — bounded staff-only заметки; атрибуция публична только после отдельного решения.
- rightsVerifiedByStaffUserId / rightsVerifiedAt — кто и когда проверил основание.
- productMatchConfirmedByStaffUserId / productMatchConfirmedAt — ручное подтверждение соответствия identity tuple точной редакции: brandId, manufacturerName, originalPartNumber, modification.

Предлагаемый DB-level инвариант: добавить ProductMedia.productId и составные FK `(productRevisionId, productId) → CatalogProductRevision(id, productId)` и `(catalogMediaIngestionId, fileVersionId, productId) → CatalogMediaIngestion(id, sourceFileVersionId, targetProductId)`. Это не позволит связать revision с upload другого товара или другого source version. Старые rows можно backfill-ить productId по revision, но ingestion остаётся nullable и такие rows автоматически NOT_PUBLIC. Точный DDL и guards — предмет будущего VIS-CAT-02A; сейчас миграции не создаются. Проверки также сравнивают identity revision под блокировкой root, а не доверяют клиентскому SKU/имени.

Подтверждения прав и соответствия — staff attestations, не автоматическое доказательство. Повторное использование upload другим товаром запрещается. На новой редакции подтверждение соответствия записывается повторно; если identity tuple менялась до первого submit, прежнее подтверждение недействительно.

## 3. Lifecycle и транзакции

1. Staff upload создаёт idempotent intent для productId. Проверяются текущая сессия, Origin, CSRF, permission, product state и ожидаемая версия.
2. Сервер потоком записывает ограниченный файл во временную закрытую область и считает размер/SHA-256. Имя, extension и MIME клиента — подсказки.
3. Владелец заранее утверждает media-specific quarantine/safety policy. Изолированный worker декодирует source, проверяет полный растровый файл и возвращает только заново закодированные варианты с dimensions и digest; отдельный scanner добавляется только если он выбран как обязательная политика и его ресурсы измерены. Worker не пишет в PostgreSQL и не имеет mount storage.
4. API сверяет output limits, пишет private FileObject/FileVersion для original и derivatives в выделенные media storageNamespace scopes, сохраняет ingestion/rendition state транзакционно. Повтор с тем же idempotency key не создаёт новые версии.
5. Staff GET metadata следует catalog.products.read и exact product relation. Derivative preview требует отдельный catalog.products.media.preview и выдаёт только обработанный derivative. Original bytes не доступны этим путём.
6. Существующий PUT replace media остаётся draft-командой с expectedVersion. Он принимает только source FileVersion, связанный с READY ingestion именно этого product, плюс alt/order/primary и явные rights/product-match confirmations. Проверка source — domain-scoped к этому ingestion/product, а не generic files.metadata.read object ACL. Команда append-ит ProductRevision; не публикует.
7. Submit/review сохраняет R1-004 workflow. Перед PUBLISH сервер требует все прикреплённые изображения READY, rights-verified и product-match-confirmed. Отказ/возврат draft и audit failure не меняют текущий public pointer.
8. Публикация атомарно переключает publishedRevisionId. Только после этого DTO может содержать изображения. Архивирование/смена pointer закрывает старые media URLs для новых запросов.
9. Удаление изображения из DRAFT — detach из следующей редакции, не удаление FileVersion. Для временных неуспешных intents задаётся TTL; permanent originals/derivatives следуют retention/backup policy.
10. Отдельная audited revoke command закрывает выдачу ingestion без переписывания опубликованной редакции. Это исключительное rights/security action, не обычная замена ProductMedia.

Storage и DB не образуют одну транзакцию. Intent создаётся до данных; stage и permanent writes используют atomic rename; после сбоя processing повторяется идемпотентно. Proposed FileVersion.storageNamespace изолирует media source и derivatives в двух media-owned directories под private-files. Bounded reconciler перечисляет только эти namespaces, сверяет пары `(namespace, storageKey)` с FileVersion и активными ingestion intents; удаляет лишь orphan bytes без DB row и без активного intent, старше отдельно утверждённого grace period, ограниченными batch. Он не удаляет существующие FileVersion rows или их данные только потому, что они не прикреплены к ProductMedia. Default file namespace и inquiry quarantine никогда не сканируются. DB row без корректного файла помечается недоступным, подаёт сигнал operations и никогда не приводит к выдаче original.

### Product-scoped staff file policy

FileObject ownership и generic files.metadata.read policy остаются без изменений; ProductMedia FK не превращается в общую file ACL. Для каталожных media endpoints действует отдельная narrow domain policy: catalog.products.read читает только ProductMedia metadata конкретного продукта/revision; catalog.products.media.preview читает только derivative, достижимый от этой связи; catalog.products.media.write может изменить draft relation, только если ingestion READY и привязан к тому же targetProductId. Ни один из этих путей не открывает original bytes или произвольный FileVersion. Это позволяет редактору/ревьюеру работать с загруженным другим уполномоченным сотрудником фото, не делая его владельцем FileObject и не расширяя generic file access.

## 4. DRAFT public API и DTO

### Routes

- Существующие GET /v1/public/catalog/products и GET /products/:slug дополняются только безопасными media fields.
- Новый GET|HEAD /v1/public/catalog/products/:slug/media/:publicAssetId/:variant возвращает binary только после проверки одним bounded query: товар не архивирован, category ACTIVE, brand NULL либо ACTIVE, publishedRevisionId существует, revision PUBLISHED, exact ProductMedia принадлежит этой редакции, ingestion READY, rights и product-match подтверждены, rendition имеет derivative FileVersion в разрешённом media derivative namespace.
- В public URL нет FileVersion ID, FileObject ID, storageKey, internal filename, source URL или revision ID. publicAssetId — locator, никогда capability.
- Staff routes: multipart POST upload требует DRAFT media.upload; GET processing state/product metadata — catalog.products.read; scoped derivative preview — DRAFT product-scoped media.preview; attach/edit — media.write для того же product и READY ingestion. Все mutations требуют Staff cookie, CSRF, Origin, OCC, default deny и per-operation audit. Generic file download endpoint не появляется.

### Пример DRAFT JSON Public DTO

    {
      "data": {
        "slug": "controller-model-x",
        "displayName": "Контроллер модели X",
        "primaryImage": {
          "assetId": "generated-public-locator",
          "altText": "Промышленный контроллер, вид спереди",
          "width": 720,
          "height": 540,
          "renditions": {
            "thumbnail": { "variant": "THUMBNAIL", "width": 320, "height": 240, "mimeType": "image/webp" },
            "compact": { "variant": "COMPACT", "width": 480, "height": 360, "mimeType": "image/webp" }
          }
        },
        "media": [
          {
            "assetId": "generated-public-locator",
            "altText": "Промышленный контроллер, вид спереди",
            "width": 720,
            "height": 540,
            "renditions": {
              "main": { "variant": "MAIN", "width": 1600, "height": 1200, "mimeType": "image/webp" },
              "full": { "variant": "FULL", "width": 2048, "height": 1536, "mimeType": "image/webp" }
            }
          }
        ]
      }
    }

Это пример, не утверждённый JSON contract. primaryImage — null без подтверждённой фотографии; media — пустой массив. Width/height относятся к derivative и резервируют layout; aspect ratio вычисляется без округления. Grid использует thumbnail, list — compact, товарная карточка — main, увеличение — full. Публичный caption не возвращается: действующий caption не утверждён как public copy. Product card получает только primary thumbnail/compact; detail — gallery в sortOrder, primary first.

Изображение не делает товар недоступным. Ошибка media GET/404/503 оставляет честный placeholder, а не «товар не найден».

### URL и Next.js

Nest API остаётся авторитетом и принимает slug + publicAssetId + variant; пути относительные, production domain не придумывается. Сейчас web SSR обращается к API по server-only API_INTERNAL_URL, а public reverse-proxy для /v1 не описан в репозитории. До реализации владелец/операции должны выбрать: (1) reverse proxy отдаёт /v1/public/* с того же origin, или (2) узкий Next Route Handler проксирует только фиксированный media route в API_INTERNAL_URL. Никаких произвольных host/URL, раскрытия API_INTERNAL_URL или wildcard remotePatterns. Для Web предпочтителен same-origin image path и Next Image с width/height, sizes, unoptimized, чтобы не запускать Next optimizer на каждом GET.

### DRAFT gallery interaction

На detail выбор миниатюры доступной кнопкой меняет основное изображение; accessible name сообщает номер и alt. Кнопка «Открыть крупно» показывает FULL rendition в native dialog. Escape закрывает dialog, фокус возвращается к trigger, предыдущая/следующая фотографии доступны кнопками и клавиатурой; narrow-screen dialog занимает viewport. Никаких зависимостей или hover-only controls. Простой отдельный URL изображения остаётся допустимой UI альтернативой и не требует смены API.

## 5. DRAFT amendments: CURRENT → PROPOSED → SECURITY REASON → COMPATIBILITY → TEST

| Contract                      | CURRENT                                                                                                                                                       | PROPOSED                                                                                                                                                                                                                                                                                                  | SECURITY REASON                                                                                                                                  | COMPATIBILITY                                                                                                                                                                         | TEST                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R1-002 FileObject/FileVersion | PRIVATE/INTERNAL; FileVersion UNCHECKED и append-only; StoragePort не является upload/ACL API.                                                                | Domain intent + stage/reconciliation; source и derivatives остаются private FileVersions. Не вводить PUBLIC visibility и не менять общий safetyState.                                                                                                                                                     | Default private; file ID не даёт доступ; bounded recovery storage/DB failures.                                                                   | Только additive amendment к новой версии R1-002; frozen schema не править.                                                                                                            | Невалидная/неавторизованная загрузка; immutable originals; replay; digest; orphan/restore.                              |
| R1-004 ProductMedia           | Exact FileVersion FK + alt/caption/order/primary; только draft metadata API.                                                                                  | Связать с READY ingestion и добавить provenance, ручные rights/product attestations.                                                                                                                                                                                                                      | Нельзя использовать необработанный FileVersion или перепутать manufacturer/modification.                                                         | Старые rows остаются NOT_PUBLIC; backfill только вручную после проверки/reprocess.                                                                                                    | Cross-product attach, identity mismatch, copy/new draft, submit/reject/publish.                                         |
| Public Catalog API            | DTO без media.                                                                                                                                                | Nullable primaryImage для cards; detail gallery; guarded binary route с fixed variant enum.                                                                                                                                                                                                               | Только активная опубликованная редакция; без private IDs/key и originals.                                                                        | Версионированный R1-004 OpenAPI amendment, generated client и contract tests после owner decision.                                                                                    | Unpublished/archive/inactive refs, unknown id, traversal, headers/cache.                                                |
| RBAC                          | Текущий staff media metadata route проверяет catalog.products.read и files.metadata.read; media.write меняет draft metadata. Ни одно не даёт upload/download. | DRAFT media.upload, media.preview, media.revoke. Новые product-media metadata routes используют catalog.products.read; derivative preview требует отдельное product-scoped media.preview; attach/edit требует product-scoped media.write и READY ingestion этого product; products.publish остаётся gate. | Generic FileVersion ACL не расширяется: ProductMedia link не даёт original access; preview открывает только derivative текущей product relation. | Catalog RBAC amendment определяет узкую product-domain policy и оставляет files.metadata.read policy generic FileObject API без изменений; роли/bootstrap не расширять автоматически. | Проверить owner/non-owner editor, reviewer preview, запрет original, cross-product id, default-deny существующих roles. |
| Audit/workflow                | media.changed уже audited; submit/publish/archive транзакционны; revisions immutable.                                                                         | Append-only actions для upload, processing, provenance verification и emergency revoke. publishedRevisionId — единственный переключатель gallery.                                                                                                                                                         | История автора/проверки/revoke без bytes/paths/полных source URLs.                                                                               | Новый additive registry version; frozen R1-002/R1-004 registries не редактировать.                                                                                                    | Audit rollback, forbidden transition, replay, pointer atomicity, revoke.                                                |

### Возможные DRAFT audit actions

- catalog.product.media.uploaded: operation/product/uploader IDs и bounded byte count; без filename/bytes/path.
- catalog.product.media.processed: operation ID, result state, bounded variant count/profile code.
- catalog.product.media.provenance.verified: product/revision/media IDs и changed field names.
- catalog.product.media.revoked: operation/source ID и bounded reason code.

Entity/action codes и PostgreSQL validation function потребуют отдельного contract PR и тестов; приведённые имена ещё не зарегистрированы.

## 6. Compatibility и rollout

Без утверждённого контракта public images остаются disabled. Старые ProductMedia rows по умолчанию NOT_PUBLIC; они не бэкфиллятся как безопасные и не выдаются до ручного подтверждения соответствия/прав и reprocess. FileVersion.safetyState остаётся UNCHECKED, оригинал не открывается. После future approval rollout начинается off. Production upload, real role grants и публикация требуют отдельных операционных разрешений.

### Обязательные поправки для MVP

- Additive ingestion/rendition lineage, exact product/revision/source ownership constraints и fail-closed readiness checks.
- Утверждённые limits, private staging/reconciliation, quarantine/safety policy, decoder isolation, rights/product-match attestations и отдельные default-deny permissions.
- API-gated выдача только подготовленных variants через текущий опубликованный pointer; типизированные public fields, cache/revoke semantics и headers.
- Audit events, generated contract/client updates и regression coverage по frozen compatibility без прямых правок исходных FROZEN artifacts.

### Опционально или отложено

- Отдельное derivative storage/CDN/purge, если измерения докажут API streaming bottleneck и владелец отдельно утвердит cache/revoke остаточный риск.
- AV scanning — решение владельца в рамках media-specific policy, не заимствование R1-010D CLEAN; если выбран mandatory scanner, его отсутствие/staleness блокирует upload.
- Автоматический import из внешних URL, SVG/animated formats, asset library вне product revisions, bulk editing и автоматический SKU/image matching в MVP не входят.
