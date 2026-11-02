# VIS-CAT-02 — безопасность media и будущая матрица приёмки

**Статус:** DRAFT / REVIEW_REQUIRED / NOT FROZEN<br>
**Использование:** проектируемые меры и будущие тесты. Ни один из тестов ниже не запускался; документ не утверждает реализацию.<br>

## 1. Threat model

### Защищаемые активы

- Приватные оригиналы, файлы заявок и внутренние документы.
- Точная идентичность опубликованного товара и соответствующей фотографии.
- Публичный сайт/API, приватный storage volume, PostgreSQL и доступность одного VDS.
- Подтверждённые права на изображение и история публикации/отзыва.

### Основные угрозы

1. Анонимный атакующий отправляет malformed, oversized, неоднозначное (в том числе polyglot-like) или decompression-bomb изображение, эксплуатируя parser/decoder или исчерпывая ресурсы.
2. Сотрудник с ограниченной ролью пытается загрузить, просмотреть, связать или опубликовать медиа сверх своих полномочий.
3. В похожие модели или одинаковый артикул разных производителей попадает одна и та же фотография без ручного соответствия.
4. Public endpoint или reverse proxy раскрывает private original, storageKey, FileVersion ID, необработанные metadata или изображение незавершённой редакции.
5. Устаревшая публичная копия остаётся доступна после замены/отзыва; обещается мгновенное удаление уже загруженных копий.
6. DB commit и запись файлов расходятся после crash, retry, restore или заполнения диска.
7. EXIF/location/source URL, EXIF thumbnails, embedded payload или ошибочный public caption утекают наружу.

## 2. Pipeline с отдельными trust boundaries

    Staff cookie + CSRF + upload permission
        -> bounded streaming upload
        -> private staging + digest + idempotent intent
        -> owner-approved media quarantine/safety policy
        -> isolated image worker (decode / re-encode, no DB/storage/secrets)
        -> API verifies output + stores private FileVersions
        -> human source-rights and exact product-match confirmation
        -> existing draft submit / human publish
        -> public route checks exact active published revision on every origin request

### Этапы и необходимые гарантии

| Этап                | Гарантия                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Авторизация         | StaffSession, Origin, CSRF, upload permission, target product state и OCC version проверяются до хранения. Upload/idempotency scoped к actor и product. Незавершённая/устаревшая сессия не продолжает загрузку.                                                                                                                                                                                                                                                                                                                             |
| Приём               | Stream, не Multer memoryStorage. Один файл за запрос; серверный byte counter прекращает чтение при лимите. Случайный server-generated intent; staging закрытый. Фактический SHA-256/size считаются на сервере. Имя и MIME от клиента не считаются доказательством.                                                                                                                                                                                                                                                                          |
| Quarantine          | Оригинал и staging не доступны public route и web container. До обработки никакая FileVersion не считается пригодной к выдаче. Частичный файл не становится source.                                                                                                                                                                                                                                                                                                                                                                         |
| Malware scan        | До реализации владелец утверждает media-specific quarantine/safety policy. Отдельная malware-проверка original digest — опция defense-in-depth, если выбраны engine/update policy и измеренные ресурсы. Если scanner выбран как обязательный, unavailable/stale — retryable fail closed; результат связан с digest, engine и signature version. Если выбран ограниченный quarantine + decode/re-encode без scanner, это не означает malware-clean. Ни один путь не даёт права публикации. Статус/решение R1-010D CLEAN не переиспользуется. |
| Изоляция decoder    | Предпочтителен отдельный worker container: non-root, read-only rootfs, no capabilities/no-new-privileges, временный каталог с лимитом, no database credentials, no storage mount, проверенный запрет egress, внутренний network только от API, concurrency 1. API валидирует весь ответ worker и остаётся единственным writer в PostgreSQL/storage. Docker bridge/internal сам по себе не доказывает запрет исходящих соединений; проверить worker egress и host firewall на целевом deployment.                                            |
| Формат              | MVP input allowlist JPEG/PNG/WebP; проверка сигнатуры + decoded format. Полностью декодировать разрешённый raster и отвергать signature/decode mismatch, truncated, corrupt и multi-frame input. Нельзя обещать обнаружение всех polyglot-файлов. SVG, GIF animation, архивы, PDF, remote URL исключены; Content-Type клиента и extension игнорируются.                                                                                                                                                                                     |
| Ограничения decoder | Проверить обе dimensions, pixel count, decoded memory estimate, frames и elapsed time до окончательного decode и во время decode. Убить worker по wall/CPU/memory limit. На выходе только новый static WebP raster; никакого копирования input bytes как derivative. Output повторно декодировать/проверить, сравнить MIME/dimensions/byte count/hash.                                                                                                                                                                                      |
| Metadata/color      | Применить EXIF orientation до resize. Удалить EXIF/GPS, XMP/IPTC, комментарии, embedded thumbnail, неизвестные chunks и input filename. Не копировать произвольный ICC profile: либо ограниченно конвертировать в sRGB, либо удалить профиль после проверенного преобразования. Выход без provenance/source URL.                                                                                                                                                                                                                            |
| Хранение            | API записывает исходник и варианты через private FileStorage. Неперезаписываемые opaque keys, hash/size сверяются с FileVersion, atomic temp rename. Storage failure/DB failure не помечает ingestion READY. Reconciliation ограничен media source/derivative namespaces: удаляются только orphan bytes без FileVersion row и активного intent, после grace period и batch cap; default namespace и inquiry quarantine не сканируются. DB row без bytes становится unavailable/alerted, source fallback запрещён.                           |
| Публикация          | READY processing не делает media публичной. Нужны draft ProductMedia link к этой версии, rights basis, проверка точной product identity для этой revision, submit/review, существующий human publish и актуальный product pointer.                                                                                                                                                                                                                                                                                                          |
| Публичная выдача    | Route принимает только slug + publicAssetId + фиксированный variant enum, не FileVersion ID/key/path. Один bounded DB lookup связывает текущий active product → published revision → ProductMedia → READY ingestion/rendition. Никаких redirect на storage, query URL или обхода через static volume.                                                                                                                                                                                                                                       |
| Отказ/ошибка        | Не маскировать сбой БД/storage/scanner ложным 200/404 товара. Product page остаётся доступна с image fallback. Никаких exception, SQL, storage paths, source URL в public response.                                                                                                                                                                                                                                                                                                                                                         |

### Нужен ли отдельный malware scanner

**Предложение:** до реализации владелец должен определить и проверить media-specific quarantine/safety policy, как требует ADR-004 для новых uploads; действующий FileVersion остаётся UNCHECKED. Возможны два решения, требующие явного одобрения: (1) локальный scanner точного original digest до decode, с закреплённым engine/signature update policy и подтверждёнными ресурсами; (2) ограниченный quarantine + изолированный decode/re-encode policy без утверждения malware-clean, если владелец считает его достаточным для этого риска. Ни один вариант не переиспользует общую файловую безопасность.<br>
Это не разрешает повторно использовать результат или статус R1-010D. Если выбран scanner, владелец отдельно утверждает поведение при отсутствии/устаревших сигнатурах и необходимость scan re-encoded output; отсутствие scanner блокирует upload fail-closed. Если выбран второй путь, upload блокируется при нарушении quarantine/decoder policy, но не объявляется malware-cleared. Никакой внешний scanning SaaS не является обязательным предложением. Отдельный worker не считается совместимым с текущим VDS без измерений; ресурсы 4 GiB/6 GiB из изолированного R1-010D профиля не доказывают пригодность для media processing и не переносятся как baseline.

## 3. Кандидаты resource limits — не утверждённые параметры

| Ограничение      | Кандидат для первого load-test                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Размер source    | ≤ 12 MiB; byte-count enforced while streaming; один файл на запрос.                                                                                                                                                                                                                         |
| Геометрия source | ≤ 10,000 px на сторону и ≤ 24 MP total; отказывать при overflow до больших allocations.                                                                                                                                                                                                     |
| Выходы           | 4 заранее созданных WebP rendition; каждый ≤ 1 MiB и общий предел ≤ 3 MiB на source. Отклонить или пересобрать качество в лимите, не отдавать оригинал как overflow fallback.                                                                                                               |
| Рендиции         | Thumbnail 320 px, compact 480 px, main 1600 px, full 2048 px по длинной стороне; не upscale, не crop, сохранить пропорции. Качество и итоговый размер подтвердить на реальном инженерном ассортименте.                                                                                      |
| Параллелизм      | Один decoder job одновременно на первом VDS; bounded queue length = 0/нет durable queue: POST ждёт результат. От backpressure — 429/503 с retry guidance.                                                                                                                                   |
| Время/память     | Worker wall timeout 20 s, CPU budget 10 s и memory 512 MiB/job — только кандидаты для codec-only worker; выбранный scanner требует отдельного бюджета. Измерить с целевым image corpus и на фактическом VDS; никакая текущая Compose-конфигурация не доказывает наличие свободных ресурсов. |
| Частота          | Rate limit по actor/session + общий concurrency cap; точные числа после нагрузочного теста, не предполагать масштабирование.                                                                                                                                                                |
| Staging TTL      | 24 часа для incomplete/retryable uploads; rejected payload удалять раньше согласно approved policy. Числа — кандидаты и требуют решения по сроку хранения.                                                                                                                                  |

Формула предварительной стоимости диска: assets × (average original MiB + сумма четырёх rendition MiB) × число backup copies.

Иллюстрация при явно условных средних: 1,000 images × (1.5 MiB original + 0.7 MiB variants) ≈ 2.2 GiB primary; одна полная off-site копия добавляет ≈ 2.2 GiB. Это не VDS/provider quote, не учитывает revisions/reprocessing, FS/DB overhead и запас. Перед лимитами нужны тестовые фото и измерение размера/CPU/RAM. Повторные source uploads не дедуплицировать по хэшу между товарами.

## 4. Renditions, delivery и кэш

### Производные форматы

- THUMBNAIL / COMPACT / MAIN / FULL — заранее создаются при upload; каждый вариант имеет фактические width/height.
- Не делать on-demand resize на публичном GET: это повторно запускает decoder для сетевого трафика и превращает endpoint в CPU amplifier.
- Сохранять исходный aspect ratio; не искажать и не обрезать маркировку оборудования. При отсутствии оригинального увеличения не upscale.
- Public response отдаёт только WebP derivative. Если требования к legacy clients потребуют JPEG, добавить отдельное rendition после проверки, не копировать оригинал.
- В карточках/lists lazy-load ниже viewport; на detail заранее резервировать ratio по width/height; main может быть приоритетным, full грузить после явного пользовательского действия.

| Вариант                 | Нагрузка и эксплуатация                                                                                                              | Решение для MVP                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Все варианты при upload | Предсказуемая CPU-нагрузка на ограниченный upload; больше постоянных файлов и операций при обработке/backup.                         | Рекомендуется: заранее делать утверждённые размеры один раз, повторный запрос идемпотентен. |
| On-demand при GET       | Низкий upload cost, но повторный недоверенный decode/resize на публичном трафике, сложнее ограничить CPU и cache misses.             | Отклонить: не запускать image processor на public request.                                  |
| Гибрид                  | Можно заранее сделать малые размеры, но генерация MAIN/FULL по первому просмотру создаёт cache stampede/retry и усложняет состояние. | Не для MVP; пересмотреть только с измерениями и отдельным contract.                         |

### Route и headers

Предлагаемый binary response:

- фиксированный Content-Type: image/webp;
- X-Content-Type-Options: nosniff;
- ограниченный Content-Length;
- ETag из output digest, поддержка If-None-Match/HEAD;
- Content-Disposition: inline без пользовательского имени файла;
- Cache-Control: public, max-age=300, must-revalidate как стартовый кандидат для версии с locator;
- invalid/неопубликованная/отозванная связь возвращает единый 404 без деталей; storage failure — 503, не подменять отсутствующий товар.
- никакого Range, если он не нужен; если поддержать — только валидированный bounded range производного файла.

### URL, замена и отзыв

Сравнение:

1. Versioned immutable URL: отлично для CDN, но stale cache дольше всего переживает отзыв.
2. Path с revision ID: проще связать с publication revision, но revision ID не нужен в public URL; другой revision не отзывает уже скачанное.
3. Opaque publicAssetId + product slug + rendition: рекомендуемый locator; не является secret/capability. API проверяет текущий published pointer на каждом cache miss/revalidation. Новый output получает новый id.

MVP: opaque random locator, API-gated route, TTL до 5 минут, ETag. При замене изображения новая public product response указывает новый locator; старый путь перестаёт проходить origin check, когда old source отсутствует в current published revision. Отдельная emergency revoke меняет ingestion state и блокирует новые origin responses. Уже скачанные/кэшированные в пределах TTL копии отозвать нельзя; публичный интернет не обеспечивает мгновенное удаление. CDN и purge API отложены, пока не утверждены отдельно.

## 5. Provenance и права

Для каждой связи ProductMedia:

- source type и bounded source reference;
- documented rights basis и ограничения;
- кто/когда подтвердил основание;
- кто/когда подтвердил визуальное соответствие brand/manufacturer/part number/modification в точной ProductRevision;
- кто загрузил (FileVersion.createdBy) и кто выполнил publish (CatalogProductRevision.decidedBy + catalog audit);
- внутренние сведения не включать в public DTO и обычные server logs.

Разрешённые ручные источники: собственное фото, производитель при подтверждённых условиях, поставщик при разрешении, работа сотрудника с разрешённым правом. Не скачивать изображения автоматически из поиска/магазинов/сайтов. Атрибуция публикуется только если это условие лицензии и владелец подтвердил публичное поле.

Снимок rights/source metadata не доказывает законность. Для сомнительной лицензии изображение остаётся draft/private. Revoke command должна немедленно закрывать route и записывать reason code/actor, сохраняя прежнюю revision историю.

## 6. Security Acceptance Matrix — будущие тесты, не выполненные

| Группа      | Проверка                                                                                                                          | Ожидаемый результат                                                                                                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload      | Неверный MIME/extension, но корректная сигнатура; наоборот, MIME image при чужой сигнатуре                                        | Решение только по разрешённой сигнатуре и декодеру; mismatch отвергнут.                                                                                                                                                     |
| Upload      | Повреждённый/truncated JPEG, PNG, WebP; malformed chunks; polyglot-like signature/decode mismatch; multiple frames                | Fail closed; READY отсутствует; staging удалён по policy. Это не заявление о детектировании всех polyglot payloads.                                                                                                         |
| Upload      | Неполный stream/client disconnect                                                                                                 | Нет FileVersion/ProductMedia; retry безопасен; временный файл очищен.                                                                                                                                                       |
| Upload      | Размер выше byte cap; dimensions выше лимита; чрезмерный pixel count/decompression bomb                                           | Stream/decode прекращается до исчерпания ресурсов.                                                                                                                                                                          |
| Upload      | Decoder timeout, OOM, crash; scanner unavailable/stale when scanner policy is selected                                            | Не READY; bounded retryable state; worker/API остаются работоспособны.                                                                                                                                                      |
| Upload      | Неавторизованный staff, отсутствующий permission, неверный Origin/CSRF, password-change required, смена/отзыв сессии              | Запрос отклонён до permanent write.                                                                                                                                                                                         |
| Upload      | Concurrent same idempotency/body; same key/different body; parallel upload сверх cap                                              | Один результат либо deterministic conflict; concurrency bounded.                                                                                                                                                            |
| Worker      | Попытка egress, чтения DB/env/secrets/storage или обращения к API admin routes; runtime reachability probe + host firewall review | Worker изолирован; deny-egress подтверждён на deployment, decoder не может менять DB/storage напрямую.                                                                                                                      |
| Storage     | Другая длина/digest, байты подменены после проверки                                                                               | READY не создаётся; digest source/output проверяется на точной записи.                                                                                                                                                      |
| Storage     | Ошибка atomic rename, ENOSPC, DB commit failure, crash между storage write/DB commit                                              | Нет публичного pointer; bounded reconciler удаляет только старые orphan bytes без DB row/active intent в media scopes.                                                                                                      |
| Storage     | Потеря derivative при наличии DB row                                                                                              | API не отдаёт original; fallback на UI; сигнал operations и безопасный repair.                                                                                                                                              |
| Storage     | Backup/restore БД и volume разных поколений                                                                                       | Обнаружение hash/link mismatch; товар остаётся доступен с fallback; restore test фиксирует сверку.                                                                                                                          |
| Publication | Публикация DRAFT/REJECTED/без обработки                                                                                           | Не проходит существующую publish gate; public DTO/media route не раскрывает.                                                                                                                                                |
| Publication | Ошибка rights/product-match; mismatch brand, manufacturer, SKU, modification                                                      | Submit/publish отвергнут; нет auto mapping/auto-substitute.                                                                                                                                                                 |
| Publication | Upload editor, reviewer иной actor; текущая grant matrix                                                                          | Читаются только разрешённые метаданные/previews; roles не расширены автоматически.                                                                                                                                          |
| Publication | Submit/reject/return/republish; concurrent publish/archive; stale OCC version                                                     | Публичный набор переключается только атомарно через текущий pointer.                                                                                                                                                        |
| Publication | Замена primary, порядка, detach из draft, архив товара                                                                            | Старый published gallery стабильна до новой публикации; archive закрывает новые GET.                                                                                                                                        |
| Publication | Emergency revoke/reason, попытка reattach revoked source                                                                          | Новые origin requests закрыты; audit есть; revoked source нельзя молча вернуть.                                                                                                                                             |
| Public      | Draft/pending/rejected media, archived product, inactive category/brand, unknown assetId                                          | Единый безопасный 404 без IDs/keys/status leakage.                                                                                                                                                                          |
| Public      | Запрос private original или произвольного FileVersion ID/key                                                                      | Нет route и нет скачивания; public locator не превращается в capability.                                                                                                                                                    |
| Public      | Content-Type, nosniff, disposition, output bytes                                                                                  | Только safe static raster; браузер не интерпретирует HTML/SVG.                                                                                                                                                              |
| Public      | Path traversal, invalid UUID/variant, encoded slash, query URL                                                                    | Reject до storage lookup; storage API не принимает client path/key.                                                                                                                                                         |
| Public      | Cache validators, stale locator, revoke, old revision, storage down                                                               | ETag/TTL соответствует контракту; origin check блокирует старое; storage 503 не маскируется.                                                                                                                                |
| Public      | Enumeration/rate flood                                                                                                            | Bounded CPU/DB/network; общие ошибки не раскрывают существование private object.                                                                                                                                            |
| Frontend    | Grid/list/table/detail, 375/768/1280/1440, длинный title/alt, missing image                                                       | Никакого overflow; fallback; семантические alt; layout reserved by dimensions.                                                                                                                                              |
| Frontend    | Lazy/eager loading, high-DPI, keyboard gallery, reduced motion                                                                    | Главная картинка приоритетна, остальные lazy; thumbnail buttons доступны с клавиатуры; dialog закрывается Escape, возвращает focus к trigger; предыдущая/следующая доступны клавиатурой; mobile dialog использует viewport. |
| Frontend    | Public DTO leak scan                                                                                                              | Нет FileObject/FileVersion ids, keys, staff ids, source/rights/audit/internal filename.                                                                                                                                     |
