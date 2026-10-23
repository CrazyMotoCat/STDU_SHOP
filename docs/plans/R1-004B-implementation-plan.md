# R1-004B — ограниченный план реализации

**Статус: утверждён для реализации по FROZEN R1-004 1.0.0.** Владелец 2026-10-24 (Asia/Vladivostok) утвердил исходный SHA `8ae4dd8cfd15e3722d97259818b238924851c963` и OD-004A-01…11. Начало R1-004B следует после merge PR #7 и успешного постинтеграционного CI. Первоначальную выдачу catalog permissions разрешено реализовать и проверить на изолированной тестовой БД; выполнение операторской команды на реальной рабочей БД не разрешено. Production migrations/deployment, реальные назначения полномочий и разрушительные операции не разрешены.

## Контракт и change ownership

- Один lead writer владеет Prisma schema, migration ordering, OpenAPI, permissions, audit registry и интеграцией.
- R1-002 1.0.0, решения #1–108 и existing protected permissions не переписывать. До первой реализации дополнить миграционный чеклист трассировкой exact approved SHA и применённой R1-002 schema.
- Целевой объем: Brand, Category, AttributeDefinition, CatalogProduct, CatalogProductRevision, ProductAttributeValue, ProductMedia, ProductDocumentVersion, ProductRelation; staff API; минимальный read-only public API; audit, OCC, тесты.

## Последовательность и ожидаемые файлы

1. **Trace approved contract:** `.agent/tasks/R1-004B/state.md`, artifact hashes, owner OD approvals, frozen R1-002 consistency.
2. **Schema/migration:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<timestamp>_catalog_domain/migration.sql`; Prisma models must implement exact composite FK/index/CHECK/tree/revision guards in approved contract. Migration is additive and never runs at app startup.
3. **Permission and audit registry:** `apps/api/src/permissions/*`, `apps/api/src/audit/*`, catalog JSON registry and schema validation extension; registry seed inserts only 12 catalog codes and no RolePermission rows.
4. **Catalog module:** new `apps/api/src/catalog/catalog.module.ts`, controller/DTO/service/repository files; controller delegates all authorization and state transitions to NestJS. Every mutation + audit is one DB transaction. Category tree/advisory and active-reference row locks (including rejection of create/reparent to an archived parent), SKU uniqueness under `COLLATE "C"`, explicit `baseRevisionId` state workflow, bounded typed attribute validation, relation source/target root locks, object-level file metadata permission and publication pointer are checked server-side.
5. **Operator bootstrap command:** only if OD-004A-05 is approved as written; add explicit API package script + CLI using existing RBAC advisory lock. No startup, migration, CI auto-execution, seed password, HTTP bypass or automatic role grant.
6. **Public projection:** only active published pointer, safe product details, safe manual accessory/compatible relation targets, `ON_REQUEST`; public category navigation uses keyset cursor pages of ACTIVE direct children, at most 100 per response, and the UI assembles deeper levels with additional requests; no public file metadata or URL while frozen file model has no safe state/delivery path.
7. **OpenAPI/client:** update `apps/api/src/openapi/*` and the contract exporter/drift pipeline so Nest export matches approved `docs/contracts/R1-004-catalog.openapi.json`; generated TS client remains reproducible.
8. **Runtime and regression tests:** `apps/api/test/catalog.runtime.test.ts` plus focused unit tests in `apps/api/src/catalog/*.spec.ts`; cover all applicable CATB-01…38 rows, including superseded revisions, post-publication and post-review draft creation, wire type bounds, fail-closed first grant, archive/reference races, exact-target relation races, unbounded keyset continuation and malformed cursor rejection, root/revision identity synchronization, and staff product state/category filters against the selected current pointers (including rejection of `ARCHIVED + categoryId`). Race tests use two independent PostgreSQL sessions and barriers, assert the second writer is blocked via PostgreSQL lock diagnostics before release, and then verify committed state. Reuse isolated PostgreSQL/HTTP harness conventions from `apps/api/test/r1-002b.runtime.test.ts` and `apps/api/scripts/run-r1-002b-runtime.mjs`; do not use mocks as evidence for database races or RBAC.
9. **Quality/CI:** extend `.github/workflows/ci.yml` only for catalog contract/runtime verification; package/scripts only for reproducible task aliases. Run lint, formatting, typecheck, unit, db validation, catalog runtime, build, UI and integration gates as repository policy requires.

## Explicit exclusions

No Supplier/SupplierOffer/IngestionRun/ImportJob/PricingRule; no ingestion or CSV/XLSX; no price persistence; no catalog image/document upload/download/public serving; no UI implementation; no safe-file policy expansion; no production migration/deploy. R1-005 may render catalog search/card/relationships and the request-price label, but media/documents remain absent until their separately approved safe file-delivery contract is implemented. Manual approval remains mandatory for every publication; no batch/automatic approval path.

## Completion evidence

Attach exact migration stdout/state, PostgreSQL rows and FK/CHECK results, HTTP request/response evidence per permission/state boundary, race blocking and final DB state, audit rollback proof, public JSON leak scan, OpenAPI/client drift proof, every applicable CATB result, all local quality-gate commands, independent read-only backend/database/security reports, exact branch/PR HEAD and required hosted CI. Do not mark accepted based only on green unit tests or contract generation.
