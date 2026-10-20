# Доменная модель, снимки и жизненные циклы R1

## 1. Сущности (предварительная логическая схема; конкретные таблицы в migrations/ADR)

### Организации и доступ

- `StaffUser(id, email, password_hash, state, ...)` — внутренний пользователь.
- `Role`, `Permission`, `UserRole`, `RolePermission`, `StaffMembership` — связь разрешений и подразделения/собственного юрлица там, где требуется.
- `SellerLegalEntity(id, name, kind[ООО|ИП], tax_config, bank_accounts, requisites, active)` — **собственные** продавцы; смена справочника не переписывает редакцию КП.
- `BusinessCounterparty(id, organization_name?, inn?, contacts, ...)` — заявители/компании-покупатели; подтверждение корпоративного кабинета — только R2.

### Каталог и коммерческие источники

- `Brand`, `Category(parent_id)`, `AttributeDefinition(category_id, type, unit, filterable)`, `CatalogProduct(brand_id, manufacturer, manufacturer_part_number, modification, slug, publication_state, ...)`.
- `ProductAttributeValue(product_id, attribute_definition_id, value)`, `ProductDocumentVersion`, `ProductMedia`, `ProductRelation` (аксессуары/совместимость, **ручные** связи).
- `Supplier`, `SupplierOffer(supplier_id, product_id?, original_sku, currency, purchase_cost, availability_text?, lead_time?, observed_at, expires_at?, source_url?, state)`.
- `SupplierSource(id, authorized_scope, origin_url, parse_adapter, freshness_policy, enabled)`.
- `IngestionRun(id, requested_by, requested_at, status, metrics, logs_pointer)`; `IngestionCandidate(id, run_id, field_path, before, proposed, origin, decision, reviewer, decided_at)`.
- `ProductMatchProposal(id, offer_id, product_id, evidence, status)` — утвердить поштучно, не автосклеивать.

### Заявки и инженерные спецификации

- `Inquiry(id, counterparty_id?, contact_snapshot, channel, kind, status, assigned_manager_id, due_at, created_at)`.
- `InquiryLine(id, inquiry_id, raw_title, sku?, qty, unit, notes?, catalog_product_id?)`.
- `SourceDocument(id, object_storage_key, checksum, mime, original_filename, uploader, uploaded_at, locked=true)`.
- `SpecImportRun(id, source_document_id, parser_version, status, issues)`.
- `SpecificationRevision(id, inquiry_id, number, origin_revision_id?, status, created_by, approved_by?, approved_at?)`.
- `SpecificationSection(id, revision_id, parent_id?, title, sequence)`; `SpecificationLine(id, section_id, raw_row_ref, raw_title, raw_part_no?, qty, unit, resolved_product_id?, resolution, notes, sequence)`.
- `SpecLineOrigin(line_id, source_document_id, sheet_page, row_coord, raw_values)`; `SpecLineAggregation(aggregated_line_id, source_line_id, qty_portion)`.
- `EngineeringReview(id, specification_revision_id, reviewer_id, status, remarks, signed_at)`; `EngineeringChangeHistory` или общий audit с историей ревизий.

### Калькуляции/КП/файлы

- `Costing(id, inquiry_id, spec_revision_id, seller_id, status, pricing_rule_snapshot, calculation_version)`; `CostLine(id, section_id, source_line_refs, purchase_offer_id?, material_cost, labor_cost, overhead_cost, logistics_cost, selling_price, tax_basis, currency)`.
- `Quotation(id, inquiry_id, seller_id, current_draft_id?, status, created_by)`; `QuotationRevision(id, quote_id, rev_no, source_costing_id, approved_by?, approved_at?, expires_at, immutable_payload_hash, seller_requisites_snapshot, tax_snapshot, pricing_snapshot, pdf_document_version_id?, public_access_state)`.
- `QuotationSection`, `QuotationLine`, `QuoteFeedback(id, revision_id, kind[interest|revision_requested], message?, created_at, actor_context)`.
- `QuoteAccessToken(id, revision_id, token_hash, revoked_at?, expires_at, permitted_actions)`.
- `FileObject(id, storage_key, checksum, mime, size, scan_state, created_by)`; `FileVersion(id, file_id, version, file_object_id, ...)`; `FileLink(file_version_id, entity_type, entity_id, visibility)`.
- `AuditEvent(id, actor_id, action, entity_type, entity_id, changed_fields, timestamp, correlation_id)`.

## 2. Инварианты

1. `CatalogProduct` может быть публичным только после положительного решения уполномоченного сотрудника; кандидаты парсера не могут напрямую менять опубликованное поле.
2. Уверенное сопоставление товара предполагает идентичные manufacturer + original_part_number + modification и утверждённую админом связь между предложением поставщика и продуктом. «Похожий функциональный аналог» — **никогда автоматический выбор**.
3. Новая ревизия спецификации не перезаписывает старые исходные строки. Техническая редакция, существенно изменённая после утверждения, должна снова пройти `EngineeringReview`.
4. `QuotationRevision APPROVED` immutable: никакой UPDATE цен/строк/налогов/продавца/сроков, только новые ревизии. При повторной публикации старый PDF сохраняется.
5. Новые цены поставщика или обновления каталога **не пересчитывают** утверждённую редакцию КП.
6. Реакция `interest` доступна только действительной, неотозванной, неистёкшей редакции; никогда не создаёт заказ в R1.
7. Файлы с внутренними ценами/комментариями исключены из публичных DTO и PDF; прямой URL файлов не обходит ACL.
8. «Готовая работа» инженера и «утверждённая коммерческая цена» — разные права/действия.
9. Для расчёта денег использовать decimal и валюту; ставка и метод применения налога — **из конфигурации продавца/КП**, без хардкода.
10. Историческое происхождение данных позволяет реконструировать результат КП без внешнего сайта/старой текущей цены.

## 3. Состояния и переходы

### Catalog / source

```text
Product: DRAFT -> PENDING_REVIEW -> PUBLISHED -> ARCHIVED
IngestionRun: CREATED -> RUNNING -> COMPLETED | PARTIAL_FAILURE | FAILED
Candidate: PENDING -> APPROVED | REJECTED
MatchProposal: PENDING -> APPROVED | REJECTED
```

Важно: `Candidate APPROVED` не всегда равно `Product PUBLISHED`: окончательная публикация зависит от других обязательных атрибутов товара и роли.

### Inquiry / spec / engineer

```text
Inquiry: NEW -> TRIAGE -> NEEDS_CLARIFICATION -> ENGINEERING_REVIEW
                                |                        |
                                +------------------------+
          -> READY_FOR_QUOTE -> QUOTE_SENT -> CLOSED
SpecificationRevision: DRAFT -> IN_REVIEW -> APPROVED | RETURNED
EngineeringReview: OPEN -> NEEDS_CHANGES | APPROVED
```

Не привязывать права к текстовым статусам на клиенте; переходы проверяются сервером.

### Quotation

```text
Quote DRAFT -> PENDING_MANAGER_APPROVAL -> APPROVED -> SENT
                                             |             |
                                             +--> EXPIRED   +--> EXPIRED
Rejected approval -> DRAFT; changes after approval -> NEW REVISION (DRAFT)
Feedback on active approved revision: INTEREST / REVISION_REQUESTED
Feedback after expires_at or token revoke: NOT ACCEPTED
```

При новой редакции возможно сохранение старой как исторической; детали хранения `current_revision_id` определить в миграции. Уточнение различия `APPROVED` и `SENT`: утверждение разрешает публикацию, отправка — отдельное событие доставки.

## 4. Конфиденциальность и изоляция

- `SellerLegalEntity` принадлежит продавцу (наш бизнес); `BusinessCounterparty` представляет клиента. Не смешивать эти идентификаторы.
- В R1 публичная заявка может быть без аккаунта. Нельзя использовать только сообщённый ИНН как доказательство права читать документы компании.
- Служебные данные (закупочная стоимость, маржа, внутренние комментарии, происхождение парсинга, поставщики) существуют в закрытых API; клиентский просмотр КП строится исключительно из `PublicQuotationDTO`.
- Расширение для R2: организационное членство клиентов, роли внутри кабинета, доступ к заказам и файлам после подтверждения принадлежности к организации.

## 5. Вопросы для миграционной модели

- Единицы измерения: отдельный справочник и ограничение количества (целые/десятичные) для конкретного SKU.
- Исторические связи: на котировках хранить как стабильный SKU FK, так и snapshots названия, артикула, количества, цены и налогов.
- Точность `Decimal`, округление строк/разделов/итога и версии ценовых правил — покрыть золотыми тестами.
- Возврат импортов и исправление связи с поставщиком — через обратимые процедуры/audit, не прямой SQL в бизнес-процессе.
