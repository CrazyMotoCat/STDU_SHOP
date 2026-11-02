# VIS-CAT-02 — решения владельца и roadmap

**Статус:** DRAFT / REVIEW_REQUIRED / NOT FROZEN<br>
**Основание:** исследование origin/main 336ec8ed82224748e8d2b76bd9a049ee7fb38fbb.<br>
**Результат этого этапа:** только предложение; implementation PR, production upload, permission grants, deployment и merge не входят.<br>

## 1. Рекомендация

Утвердить вариант A:

- оставить FileObject/FileVersion единственным реестром source/derivative bytes;
- оставить ProductMedia единственной связью с точной ProductRevision;
- добавить минимальные CatalogMediaIngestion и CatalogMediaRendition records для upload/process state и выходных вариантов;
- хранить оригинал и производные версии только в существующем private-files volume;
- пропускать недоверенный decoder через изолированный, ограниченный worker без DB/storage secrets; без Redis/broker; подтверждать deny-egress на реальной deployment-сети и host firewall;
- выдавать только derivative через NestJS route, который каждый раз проверяет current publishedRevisionId и ProductMedia.
- сохранять public gallery пустой/fallback, пока авторские права, product match и публикация не подтверждены.

Это минимально расширяет существующие сущности и избегает публичной файловой системы. Отдельная ProductMediaAsset не нужна: она повторит FileVersion как file identity и ProductMedia как revision relationship. Отдельное public derivative storage оставить fallback только после измеренной нагрузки.

## 2. Решения, требующие владельца до contract PR

1. **Архитектура хранения и выдачи.** Подтвердить A: source/derivatives в private volume и NestJS-gated stream; C допускается позже при измеренном API bottleneck. Не добавлять FileObject.visibility=PUBLIC и не открывать generic FileVersion route.
2. **Quarantine / scan policy.** До uploads утвердить media-specific quarantine/safety policy по ADR-004 и изолированный decoder. Выбрать (a) отдельный scanner с поддержкой engine/signature updates и fail-closed при stale/unavailable, либо (b) явно ограниченную quarantine + isolated decode/re-encode policy без заявления malware-clean. R1-010D CLEAN нельзя переиспользовать; его ресурсы 4 GiB/6 GiB относятся к отдельному тест-профилю и не являются sizing evidence для media/VDS.
3. **Rights basis и визуальное соответствие.** Утвердить минимальный закрытый список rightsBasis, обязательность документированного reference для сторонних фото, кто подтверждает условия и кто подтверждает точную manufacturer/model/part-number/modification. Это не юридическое заключение. Сомнительный источник оставлять private.
4. **Отзыв и кэш.** Разрешить отдельное media.revoke permission и немедленное закрытие новых origin requests; принять, что уже полученные копии остаются у клиента, а 5-минутный TTL — только кандидат. Если требуется более строгий отзыв, выбрать no-store или другую политику; CDN/purge пока вне MVP.
5. **Внешний URL для браузера.** В infra/operations определить, проксирует ли production reverse proxy /v1 с public web origin. Если нет — утвердить узкий same-origin Next.js media proxy. Не задавать фиктивный домен и не добавлять wildcard image host.
6. **Ресурсы/retention.** Утвердить после fixture/load-test source/pixel/output лимиты, codec/scanner resource budgets отдельно, параллелизм, staging TTL, grace period и batch cap для orphan-byte reconciliation, удержание unattached originals и off-site backup. Candidate values из security proposal не являются принятыми.

Дополнительное owner choice: должна ли публикация ProductRevision требовать разных actors для upload/rights verification и publish. В текущем контракте это не установлено; предложение не должно silently добавлять segregation-of-duties invariant.

## 3. Затраты и сложность — относительная оценка

| Компонент варианта A | Разовый объём                                                                                                                                            | Постоянная стоимость/операция                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL           | 2 новые media-operation/rendition tables, additive ProductMedia provenance/FKs/indexes/guards, отдельный audit registry amendment. Нет destructive down. | Немного метаданных на фото; ревизионная история сохраняет связь и attestation.                                                                                     |
| API                  | Upload intent/idempotency, stream bounds, staff preview, public gated stream, DTO fields, rate/concurrency and recovery.                                 | Public GET выполняет один bounded DB check и stream; не перекодирует изображение на GET.                                                                           |
| Worker/scanner       | Изолированный internal-only container, закреплённые versions, sandbox profile, health/timeout и проверяемый deny-egress. Нет брокера и внешнего SaaS.    | CPU на upload; при выбранном scanner — signature maintenance и отдельный RAM/CPU budget. Параллелизм и пригодность фактического VDS доказать нагрузочными тестами. |
| Storage              | Повторное использование private-files volume и существующих backup procedures. Приблизительно 1 source + 4 derivatives на принятую фотографию.           | Условная оценка: 1,000 × (1.5 MiB original + 0.7 MiB renditions) ≈ 2.2 GiB primary и столько же на одну полную backup copy. Не provider quote.                     |
| Staff UI             | Upload state, derivative preview, alt/order/primary, source/rights fields, exact identity confirmation и существующий submit/review.                     | Работа менеджера/редактора: вручную подтвердить source rights и SKU match, без авто-сопоставления.                                                                 |
| Public UI            | Primary thumb/compact в grid/list и gallery в карточке товара; no-image fallback; dimensions for layout; same-origin URL.                                | Browser/network transfer размеров выбранных variants; lazy-load gallery; до CDN не требуется новая инфраструктура.                                                 |

### Сравнительная сложность

- A: **medium**. Однократные schema/API/worker/UI задачи; ниже число сущностей и operation surfaces.
- B: **high**. Вторая file/media identity, ACL и lifecycle; выше риск divergent state и миграции.
- C: **medium-high**. Лучший direct throughput, но новые storage/backup/reconcile/revoke/proxy обязанности. Не оправдан без performance evidence.

Окончательный CPU/RAM/disk и календарная стоимость неизвестны до выбора VDS capacity, scanner и тестового набора. Численные candidate limits в security proposal не являются обещанием SLA.

## 4. Будущий rollout — маленькие PR

Предварительное разбиение; все этапы ждут владельческого согласования контракта.

### VIS-CAT-02A — Contract amendments

- DRAFT-версия R1-002/R1-004: ingestion, renditions, ProductMedia provenance, DTO, endpoint, permissions, audit, cache/revoke, retention и operational limits.
- Никаких правок исходных FROZEN файлов; новые версии/append-only amendments и generated OpenAPI/client tests.
- Решения 1–6 закрываются до начала backend runtime.

### VIS-CAT-02B — Secure media ingestion

- Owner-approved quarantine/safety policy, изолированный worker и private staging; stream limits, digest, idempotency, failure recovery, bounded media-namespace orphan reconciliation и deployment egress verification.
- Создание immutable private FileVersions для source + derivatives только после полного pipeline success.
- Unit/integration/security tests: parser/limits, worker isolation, hash/DB/storage consistency, scanner failure.
- Никакого public URL и автоматической публикации.

### VIS-CAT-02C — Revision publication & public media delivery

- Проверки attach на точную product identity/READY state/rights; audit; existing submit/review/publish atomicity.
- Public DTO image fields и API-gated binary route; headers/cache/revoke; no public original.
- Contract/integration/security tests на published pointer, drafts, archive, stale/revoked source, headers.
- Публичная выдача включается только на полностью проверенных fixture records.

### VIS-CAT-02D — Staff media UI

- Путь редактора: выбрать файл → local preview → upload/progress → проверять processing state → показать только derivative preview → прикрепить к текущей draft revision.
- Несколько фото: задать primary, порядок и alt; удалить связь только из draft; отдельно сохранить source/rights basis и подтвердить manufacturer/model/part-number/modification.
- Дальше действует существующий submit → reviewer decision → publish workflow; OCC conflict handling, keyboard access, empty/error states.
- Не обходить staff CSRF, permissions, audit или revision workflow.

### VIS-CAT-02E — Public product gallery

- Grid thumb, list compact, product detail main/full; same-origin image path; responsive layout, aspect-ratio reservation и fallback.
- Lazy-load, без Next optimizer на каждый GET, без external image host.
- UI tests desktop/mobile 375/768/1280/1440; без демонстрационных/неподтверждённых фотографий.

### Возможная оптимизация разбиения

Если контракт и API small enough, 02C может объединить Public DTO/API stream; 02D и 02E остаются разными review surfaces. Не объединять staff upload и public exposure в один PR: у них разные права и security acceptance. Вне этих PR отдельное измерение throughput может открыть вариант C.

## 5. Условия готовности реализации

- Существующий ProductMedia/FileVersion остаётся единственной source-of-truth relationship/storage lineage.
- Непроверенный оригинал никогда не отдаётся клиенту.
- Image pipeline не превращает scan result в разрешение на публикацию.
- Каждая public gallery подтверждена для точной revision identity и документированных rights.
- Новые permissions имеют default deny и явное владельческое назначение; current roles не расширяются.
- Публичная связь возникает только при current active publishedRevisionId; архив/revoke прекращает выдачу новых origin responses.
- Backup/restore и orphan recovery покрывают и PostgreSQL, и private volume.
- Ни один тест из VIS-CAT-02-media-security-and-acceptance.md не заявляется выполненным до реализации и запуска.
