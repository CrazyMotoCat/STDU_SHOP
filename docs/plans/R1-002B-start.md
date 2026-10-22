# R1-002B — старт по утверждённому контракту

**Статус: READY TO START / NOT IMPLEMENTED. Delivery: AUTO_MERGE.**

## Основание и неизменяемый вход

- Owner утвердил OD-002A-01…08 на source SHA `867184f60d5306b58dd66ac6607a6ec0487761d3`; [provenance](R1-002-contract-decisions.md).
- FROZEN1.0.0 зафиксирован коммитом `bf0b66d06cca7a061c35d3f9e7af9a99f5f5ea57`, интегрирован PR #4 на `3075337058fb63262b59d64a725fbaa30def6b93`. Post-integration [CI39779081785](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39779081785) SUCCESS. Перед реализацией заново fetch/guard текущего main.
- Источники: [DB JSON](../contracts/R1-002-data-model.json), [RBAC JSON](../contracts/R1-002-rbac-matrix.json), [OpenAPI](../contracts/R1-002-staff.openapi.json), [auth/security](../contracts/R1-002-auth-security.md), [audit registry](../contracts/R1-002-audit-registry.json), [T-01…T-40](../contracts/R1-002-test-matrix.md), [пошаговый план](R1-002-implementation-plan.md).
- Требования ADM-01/03, REQ-04, основа QUOTE-03; решения №10/16/49/50/55/85, ADR-001/003/004. Исторические решения №1–108 не менять.

## Цель и разрешённые границы

Реализовать ровно 11 моделей и 23 операции frozen Staff API: сотрудники, configurable RBAC, PostgreSQL sessions, bootstrap/recovery, own sellers, audit и typed file metadata. NestJS владеет permissions/transitions. Все 12 защищённых базовых прав сохраняются в effective union хотя бы одного пригодного ACTIVE full-admin; grant ceiling/self-edit/control-admin инварианты обязательны.

Frozen OpenAPI -> Nest generation -> строгая semantic equality/route+guard inventory -> generated TS client; без ручных DTO и UI входа. Paths, поля, коды ответов и политики не переопределять при выборе структуры модулей. Один ведущий writer схемы/миграций/OpenAPI/permissions.

## Первый ограниченный срез

1. Guard/checkpoint на свежем main, короткоживущая `codex/` feature branch, проверить frozen checker. Ничего не применять в существующую пользовательскую/production DB.
2. По шагу1 плана подготовить 11 Prisma моделей и reviewed первую SQL migration с BEGIN/COMMIT, FK/CHECK/indexes/append-only audit/grants, без account/password seed. Shared SQL/schema владеет ведущий.
3. На отдельной ephemeral test DB доказать применение/rollback mid-DDL failure, SQL constraints/runtime-role deny и сохранность sentinel fixtures; явное разделение migration owner/runtime role. Реальные PostgreSQL evidence, не mocks.
4. Последующие срезы — bootstrap/audit/RBAC, sessions/security, frozen endpoints, OpenAPI/client и весь T-01…T-40 — выполнять по уже утверждённому плану. Первый срез не является выполнением всей B.

Планируемые новые команды B в implementation-plan не считаются существующими или выполненными. Их добавляет реализация вместе с тестами. Существующие frozen checker/test и root quality commands доступны сейчас.

## Gates приёмки и интеграции B

- Все T-01…T-40 реализованы и фактически выполнены; отдельные SQL/HTTP/cookie/CSRF/negative permission тесты, deterministic PostgreSQL lock/wait evidence для гонок, fault injection audit/session rollback.
- Обязательные независимые READ_ONLY application-security и database reviews; backend review согласно плану. BLOCKER/HIGH/MEDIUM закрыты и перепроверены до merge.
- Полный quality gate, OpenAPI/client drift, миграции, security и применимые Windows/Ubuntu smoke; exact HEAD/actual candidate CI. После удовлетворения GitHub rules автономный merge и проверка final-main CI.
- Отчёт разделяет PASS/NOT RUN, фиксирует paths/команды/PR/итоговый SHA; ручные бизнес-согласования не выводятся из тестов.

## Не входит

Каталог CRUD, RFQ/ingestion queues, инженерные/финансовые процессы, КП, upload/download/сканирование файлов, новые сервисы/MFA/IdP, UI входа, заказы/склад/производство и R1-003. Production-миграции/развёртывание, секреты и удаление пользовательских данных/volumes не разрешены. Разрыв frozen-контракта требует отдельного решения владельца; не исправлять его молча в реализации.
