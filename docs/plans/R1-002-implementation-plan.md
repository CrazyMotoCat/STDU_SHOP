# R1-002B — ограниченный план реализации по FROZEN 1.0.0 контракту

**Статус плана: READY TO START. Контракт: FROZEN 1.0.0. Реализация NOT IMPLEMENTED.**

A объединена через PR #4 на main3075337058fb63262b59d64a725fbaa30def6b93, post-integration CI39779081785 SUCCESS. Ограниченное стартовое задание: [R1-002B-start.md](R1-002B-start.md); checkpoint: `.agent/tasks/R1-002B/state.md`.

Вход: owner утвердил [пакет](R1-002-contract-decisions.md) на SHA 867184f60d5306b58dd66ac6607a6ec0487761d3; FROZEN1.0.0/provenance фиксируются в A. После интеграции A и post-integration CI подготавливается старт B — AUTO_MERGE, независимый read-only security/DB/backend review, без production migration/deploy. Один ведущий writer схемы/миграции/OpenAPI/RBAC; параллельные writers контрактов не нужны.

## Срезы и файлы

| Шаг | Конкретные пути B                                                                                                                                                                | Результат / gate                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | `.agent/tasks/R1-002B/state.md`, frozen docs/contracts                                                                                                                           | Guard/fresh main, разрешённый scope и SHA контракта; никаких неизвестных dirty изменений                                                                   |
| 1   | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/<timestamp>_staff_foundation/migration.sql`, `apps/api/prisma.config.ts`, `apps/api/package.json`, `pnpm-lock.yaml` | 11 моделей, Prisma7.10.1 client/adapter, generated client, FK/CHECK/indexes/triggers/grants; reviewed first migration, без пользователя/password seed      |
| 2   | `apps/api/src/identity/`, `apps/api/src/audit/`, `apps/api/src/database/`, `apps/api/src/cli/staff-bootstrap.ts`, `staff-recover.ts`                                             | Локальные bootstrap/recovery, Argon2id, transactional audit/last-admin lock; concurrent migration/bootstrap tests на изолированной PG                      |
| 3   | `apps/api/src/identity/{sessions,csrf,rate-limit,auth.controller,auth.dto,guards}.*`, `apps/api/src/config/`, `scripts/env-init.mjs`, `.env.example`                             | Login/logout/me/password/CSRF, two cookie profiles и trusted proxy; secrets генерируются, не выдумываются/не в Git; runtime deny/security tests            |
| 4   | `apps/api/src/staff/`, `apps/api/src/permissions/`, `apps/api/src/sellers/`, `apps/api/src/files/metadata.*`                                                                     | Только OpenAPI 23 операции; permissions отделены от job titles, object checks; файлы metadata-only, StoragePort без byte adapter/endpoints                 |
| 5   | `apps/api/src/openapi/export.ts`, `scripts/contracts.mjs`, `packages/staff-client/{package.json,src/schema.d.ts,src/client.ts}`, `pnpm-workspace.yaml` при необходимости         | Ни frontend handwritten DTO, ни UI. Typed fetch wrapper credentials/include + CSRF lifecycle; schema generated только из проверенного generated OpenAPI    |
| 6   | `apps/api/tests/{identity,rbac,audit,sellers,files,migrations,contract}/`, `scripts/tasks.mjs`, `.github/workflows/ci.yml`                                                       | Выполнить каждую строку test matrix на реальном PG/HTTP/cookie jar, concurrency и SQL-denial; contract mismatch fixtures проверяют checker                 |
| 7   | `README.md`, `README_START_HERE.md`, task report/checkpoint                                                                                                                      | Актуальные команды, local/dev cookies/CLI, NOT RUN отделены от PASS, CI на exact head/candidate и final main; независимый review, исправления и AUTO_MERGE |

Названия директорий предлагаются для реализации; контрактные operationId/DTO/permission/DB invariants менять из-за структуры папок нельзя. Нет каталога, CRM, финансов, upload/download, отдельного task manager, ingestion queues, UI входа или новых сервисов.

## Точная цепочка OpenAPI

`Frozen OpenAPI -> NestJS DTO/controller/guard metadata -> generated OpenAPI -> validation + strict semantic comparison -> generated TS schema + typed openapi-fetch wrapper -> contract/security tests`.

Предлагаемые pinned tool versions, проверенные по npm registry 2026-10-22: `@nestjs/swagger@12.0.2` (peers Nest12), `@apidevtools/swagger-parser@13.1.0`, `openapi-typescript@7.13.0`, `openapi-fetch@0.17.0`. Node24/pnpm11 существующего toolchain; Prisma7.10.1 сохраняется. Runtime validation libraries/Argon2 binding в B pin после проверки Node24/Python независимости и security review; существующие lockfiles менять только B. Это инструменты разработки, не новая инфраструктура. Не применять пример текущей Prisma8 документации вместо утверждённых Prisma7 SQL migrations; [v7 custom migration guide](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/unsupported-database-features).

1. Frozen JSON не генерируется из кода и не перезаписывается автоматически. Экспорт Nest `SwaggerModule.createDocument` поднимает in-memory application metadata без listen/production DB/seed. Результат в ignored `.local/contracts/generated-staff.openapi.json`.
2. Декораторы permissions/public/csrf должны питать **и guard, и OpenAPI x-extensions из одного metadata source**. Route inventory проверяет все реальные staff routes: ровно operationId/method/path/spec; unannotated route default deny. Нельзя вручную написать Swagger x-permission, не подключив guard.
3. Parser validation обеих схем, затем canonical semantic projection: paths/methods/operationId, required/nullable/type/format/pattern/min/max/additionalProperties/enum, security schemes и operation security, parameters/headers/requestBody, response status/DTO, x-permission/x-csrf/x-audit/x-invariants/x-error-codes. Ignore только порядок ключей/описания/examples/теги cosmetic и server URL deployment configuration; policy extensions не cosmetic. В B требуется **равенство**, не только отсутствие breaking изменений: даже лишний endpoint/permission/default response проваливает gate. Отдельные compatibility fixtures показывают удалённый401, ослабленный required, лишнее passwordHash, отсутствующий guard, изменённое permission и CSRF как FAIL.
4. Runtime integration проверяет, что код соблюдает declared statuses/validation, Content-Type, credentials/CORS/cookies, default deny, body sanitization. Static OpenAPI equality не доказывает auth/audit/DB correctness; матрица ниже обязательна.
5. Только после comparison PASS `openapi-typescript` генерирует `schema.d.ts` из **generated** OpenAPI; `openapi-fetch` использует эти paths без ручного копирования DTO. Wrapper предоставляет credentials/include, CSRF in-memory, bounded retry только challenge refresh (не повтор mutation), не хранит auth token. Воспроизводимая повторная генерация и `git diff --exit-code -- packages/staff-client/src/schema.d.ts` проверяют drift. Секреты/реальные реквизиты не попадают в examples.
6. Frozen version update требует owner contract decision; guard tests обновляются вместе. CI не «лечит» mismatch overwrite-ом frozen файла.

## Команды B (проект, сейчас не запускать как существующие)

```powershell
pnpm install --frozen-lockfile
pnpm env:init
pnpm infra:up
pnpm --filter @stdu/api db:validate
# Только выделенная локальная/CI test DB; явное применение оператором/test harness:
pnpm --filter @stdu/api db:migrate:deploy
pnpm --filter @stdu/api staff:bootstrap --email <owner-email> --display-name <name> --operator <label>
# Пароль в скрытом prompt, не argv/env.
pnpm --filter @stdu/api openapi:export
pnpm contract:check
pnpm client:generate
pnpm test:identity
pnpm test:migrations
pnpm test:security
pnpm toolchain:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm smoke
pnpm compose:stop
pnpm smoke:host
```

Названные новые scripts должны быть добавлены/показаны в B; этот список не выдаётся за выполненные команды A. `db:migrate:dev --create-only` используется только владельцем migration на одноразовой dev DB для генерации и review SQL; не на заполненной пользовательской DB. Deploy не из startup/health/автодеплоя. Test harness не использует существующий пользовательский PG volume, создаёт отдельную tagged test DB и удаляет только её после проверки literal target/owner. PostgreSQL/Redis foundation volumes сохраняются.

## Приёмка B

Все T-01…T-40 из [матрицы](../contracts/R1-002-test-matrix.md) PASS с фактическими результатами, без незаявленных skips. На Windows и Ubuntu применимая runtime/session/migration проверка; current PR head и actual candidate/tree известны; нет HIGH/BLOCKER/MEDIUM открытых дефектов. Review backend/security/DB независим от writer. AUTO_MERGE разрешён только в одобренных границах и по GitHub rules; итоговый main SHA/CI подтверждены. Human approval каталога/engineering/КП не выводится из CI и вообще не реализуется этим B.

## Источники инструментов

[Nest Swagger](https://docs.nestjs.com/openapi/introduction), [OpenAPI3.0.3](https://spec.openapis.org/oas/v3.0.3.html), [swagger-parser](https://github.com/APIDevTools/swagger-parser), [openapi-typescript/openapi-fetch](https://openapi-ts.dev/introduction). Spec version3.0.3 выбрана для совместимости со строгими схемами/валидатором; не заявление, что это самая новая версия OAS.
