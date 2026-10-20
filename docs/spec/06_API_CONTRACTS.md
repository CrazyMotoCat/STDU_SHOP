# Эскиз API и событий R1 — для последующей фиксации OpenAPI

**Статус:** проектная поверхность. Ведущий агент должен зафиксировать DTO/HTTP-коды/permission matrix в OpenAPI **до параллельной реализации frontend и backend**. Ниже не означает, что API уже существует.

## 1. Публичные API

| Метод | Маршрут | Действие |
|---|---|---|
| GET | `/v1/public/catalog/categories` | дерево публичных категорий |
| GET | `/v1/public/catalog/products` | фильтры, поиск, пагинация, режим отображения на фронтенде |
| GET | `/v1/public/catalog/products/{slug}` | свойства, медиа, допустимая цена или «По запросу», документы |
| GET | `/v1/public/content/{slug}` | шаблонные страницы и SEO |
| POST | `/v1/public/inquiries` | анонимная заявка, rate-limit/anti-spam |
| POST | `/v1/public/inquiries/{id}/attachments` | ограниченная загрузка после привязки к защищённому upload-intent |
| GET | `/v1/public/quotes/{accessToken}` | минимальный клиентский DTO утверждённой версии |
| POST | `/v1/public/quotes/{accessToken}/feedback` | `interest` или `revision_requested` только на действительном КП |
| GET | `/v1/public/quotes/{accessToken}/pdf` | авторизованная по токену выдача именно этой редакции PDF |

Маршрут с токеном может не быть лучшим вариантом логирования; на ADR выбрать безопасную схему, минимизирующую попадание секрета в аналитические логи и Referer. Без идентификатора `accessToken` нельзя получить приватные данные.

## 2. Внутренние API

| Контекст | Пример команд |
|---|---|
| staff/auth | `POST /v1/staff/auth/login`, `POST /logout`, `GET /me` |
| catalog | `POST /v1/staff/catalog/products`, `PATCH /{id}`, `POST /{id}/submit`, `POST /{id}/publish` |
| catalog imports | `POST /v1/staff/catalog/imports`, `GET /{id}/preview`, `POST /{id}/apply` (с ручным подтверждением) |
| suppliers | `GET/POST /v1/staff/suppliers`, `GET/POST /offers`, `POST /match-proposals/{id}/decision` |
| parser | `POST /v1/staff/ingestion-runs` (ручной admin action), `GET /{id}`, `GET /{id}/candidates`, `POST /candidates/{id}/decision` (одна запись) |
| inquiries | `GET /v1/staff/inquiries`, `GET /{id}`, `PATCH /{id}/assignee`, `POST /{id}/comments`, `POST /{id}/transition` |
| spec | `POST /v1/staff/inquiries/{id}/spec-imports`, `GET /{runId}`, `GET /spec-revisions/{id}/sections`, `PATCH /spec-lines/{id}/resolution`, `POST /spec-revisions/{id}/submit` |
| engineer | `POST /v1/staff/spec-revisions/{id}/reviews`, `POST /reviews/{id}/approve`, `POST /reviews/{id}/return` |
| pricing | `POST /v1/staff/costings`, `PATCH /{id}/lines`, `POST /{id}/calculate`, `GET /{id}/breakdown` |
| quotations | `POST /v1/staff/quotes`, `PATCH /{id}/draft`, `POST /{id}/submit`, `POST /{id}/approve`, `POST /{id}/publish`, `POST /{id}/new-revision`, `POST /{id}/revoke-access` |
| documents | `POST /v1/staff/files/upload-intent`, `POST /files/{id}/versions`, `GET /files/{id}/download` |
| admin/org | `GET/POST/PATCH /v1/staff/sellers`, `GET/POST /v1/staff/pricing-rules`, `GET /v1/staff/audit` |

Это группы, а не финальный перечень CRUD. Непроверенные «generic admin PATCH» должны быть запрещены, если поле принадлежит утверждённой ревизии.

## 3. Стандарты ответов

```json
{
  "data": { "id": "UUID", "status": "DRAFT" },
  "meta": { "requestId": "opaque-id" }
}
```

Ошибки: стабильно кодируемые `code`, `message`, `fields?`, `requestId`. Примеры кодов: `FORBIDDEN`, `FILE_REJECTED`, `SOURCE_NOT_ALLOWED`, `INGESTION_NOT_REVIEWED`, `ENGINEERING_APPROVAL_REQUIRED`, `QUOTE_REVISION_IMMUTABLE`, `QUOTE_EXPIRED`, `MARGIN_EXCEPTION_APPROVAL_REQUIRED`.

## 4. События домена

- `IngestionRunRequested`, `IngestionCandidateStored`, `IngestionCandidateReviewed`.
- `InquiryCreated`, `SpecificationImported`, `SpecificationRevisionApproved`, `EngineeringRevisionReturned`.
- `CostingCalculated`, `MarginExceptionRequested`, `QuotationRevisionApproved`, `QuotationPublished`, `QuotationExpired`, `QuotationFeedbackReceived`.
- `DocumentVersionAttached`.

События — **внутренний** механизм модульного приложения, не публичная шина обязательных микросервисов. Производимые события должны быть идемпотентны и по возможности записываться транзакционно (outbox при необходимости, если без него теряются сообщения).

## 5. Контракт Python ingestion

- Внешний сайт поставщика доступен только при ручном запуске администратора через доменный API.
- Python получает `job_id`, список разрешённых хостов/адаптеров, policy и указание staging-хранилища.
- Результат: `raw_source_blob_ref`, `normalized_candidates[]`, `extraction_warnings[]`, `source_timestamp`, `adapter_version`, `job_id`.
- Сервис получает исходный `SourceDocument` для разбора XLSX/CSV/PDF и возвращает строки с `sheet/page`, `coordinate`, `hierarchy`, `original_text`, `parsed_fields`, `confidence/warnings`.
- Никаких исходящих запросов к произвольному URL, переданному неавторизованным пользователем; явная валидация адресов и DNS, ограничение перенаправлений, таймаутов, размера и типа контента.
- Создание `CatalogProduct PUBLISHED`, выбор функционального аналога и утверждение технического решения — **исключительно** внутренние бизнес-команды NestJS с проверкой роли.

## 6. Контракт фронтенда

- Модуль UI не рассчитывает авторитетную стоимость заказа и не решает, разрешено ли действие. Он отображает расчёт backend и ограничения по ролям.
- Зафиксировать дизайн-токены `graphite=#172838`, `petrol=#177A83`, `silver=#E4EEF0`, `background=#F7F8FA`, `white=#FFF`.
- Использовать backend-версии DTO, не дублировать hand-written типы в web; изменение контракта — сначала OpenAPI, затем regen TS клиента и тесты.
- Фильтрация и пагинация каталога возвращаются API, клиент хранит режим плитка/список/таблица.
