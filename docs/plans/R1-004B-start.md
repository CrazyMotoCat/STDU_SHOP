# R1-004B — старт по FROZEN 1.0.0

**Статус: IN_PROGRESS, выполнены трассировка и additive schema/permission/audit foundation (шаги 1–3 частично). Дата: 2026-10-24 (Asia/Vladivostok). Режим: AUTO_MERGE.**

Владелец утвердил OD-004A-01…11 на SHA `8ae4dd8cfd15e3722d97259818b238924851c963`. FROZEN metadata HEAD: `0a749af35e422f55be050bd256ea1e8639193541`. [PR #7](https://github.com/CrazyMotoCat/STDU_SHOP/pull/7) объединён в `main` как `24c9653780c7e8dc511dd5acf1706ecdb9e191eb`; [постинтеграционный CI #31](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39970886845) прошёл до начала R1-004B. Базовый main с записью COMPLETE для R1-004A: `ab7f5a25a7d36d2d722e36effb8c9fecb848c88a`.

Нормативный объём задан [планом реализации](R1-004B-implementation-plan.md) и [матрицей CATB-01…38](../contracts/R1-004B-test-matrix.md). Реализованы девять моделей, additive migration и registry extension 12 catalog permissions/audit events. Владелец отдельно одобрил additive enum этих кодов в существующих permission-list/current-permissions/role-permission API схемах; protected full-admin set не расширялся. Operator command и каталогный runtime API ещё реализуются; CATB runtime acceptance не выполнялись.

## Трассировка и команды

Хеши утверждённых каталогных артефактов, FROZEN R1-002, реестра решений и baseline Prisma сохранены в [.agent/tasks/R1-004B/contract-lock.json](../../.agent/tasks/R1-004B/contract-lock.json). SHA-256 рассчитывается по UTF-8 с нормализацией CRLF → LF согласно Git text policy, поэтому проверка переносима между Windows и Ubuntu. Проверка читает файлы, не подключается к БД и не изменяет данные:

```powershell
node .agent/tasks/R1-004B/verify-contract-lock.mjs --baseline
pnpm catalog:contract:check
pnpm catalog:contract:test
pnpm db:validate
```

После намеренного изменения Prisma в шаге 2 запускать verifier без `--baseline`: frozen-артефакты остаются неизменными, а baseline-хеши схемы/миграции служат исходным снимком для review. Исходная миграция `20261022120000_staff_identity` не переписывается. Состояние применённых миграций рабочей БД этой фазой не проверялось.

CI выполняет verifier без `--baseline` отдельным шагом `R1-004B frozen contract trace`; таким образом, новые Prisma модели не блокируются исходным хешем, а нормативные frozen-файлы защищены от дрейфа.

## Последовательность и ownership

1. **TRACE — выполнено:** source/freeze/merge SHA, lock артефактов, baseline 11 staff моделей и одной существующей миграции.
2. **Schema + migration — выполнено:** один lead writer добавил девять моделей и новую additive migration; прежняя staff migration не менялась. Добавлены composite FK/current-pointer/workflow/immutability/archive/reference guards.
3. **Permission/audit registry — база выполнена:** ровно 12 catalog Permission codes регистрируются без RolePermission assignment; append-only audit validator расширен для frozen catalog events и старые R1-002 actions остаются валидными. Изолированные fresh/populated PostgreSQL проверки подтверждают сохранность staff/file/audit/permission fixtures, отсутствие grants, workflow/immutability/archive guards и RBAC audit для owner-approved enum extension. Owner-approved extension отражена в staff OpenAPI/client/contract-lock; protected full-admin sets не менялись.
4. **Module/workflow — следующий срез:** staff reference CRUD, immutable draft snapshots, OCC, submit и ручные publish/return/reject/archive, typed attributes, relation/file metadata — по утверждённым API и правам.
5. **Operator CLI:** реализация и проверки только на task-owned изолированной тестовой БД. Утверждение контракта не заменяет отдельное разрешение на реальную выдачу полномочий.
6. **Public projection + client:** exact published pointers, ON_REQUEST, category keyset pagination, точные technical filters из OD-004A-06, экспорт OpenAPI и воспроизводимый generated client.
7. **Runtime/review/CI:** тесты добавляются с каждым срезом; завершение требует всех CATB-01…38, независимых backend/security/database reviews и CI точного итогового HEAD/merge candidate.

Shared schema, migration ordering, OpenAPI, permissions и audit имеют одного владельца. Независимые reviewers работают read-only; write-параллелизм допускается только после стабилизации границ и на отдельных ветках/worktrees.

## Чеклист миграционного и runtime-доказательства

- До catalog migration на изолированной fresh/populated fixture проверить применённую R1-002 migration, количество/хеши контрольных строк и audit/session/file fixtures. Рабочая БД не используется как тестовая. — PASS локально.
- Применить новую additive migration транзакционно; зафиксировать SQL stdout, таблицы, FK/CHECK/index/guard проверки и сохранность исходных fixtures. Не включать migration в app startup. — PASS локально на PostgreSQL 18.6 без persistent Docker volume.
- Проверять HTTP через собранный Nest application с реальными cookie/Origin/CSRF/RBAC границами; считать успешными только фактически выполненные сценарии.
- Для гонок использовать две PostgreSQL сессии, barriers и подтверждение lock wait через `pg_stat_activity`/`pg_blocking_pids` до release; затем проверять committed state, audit и rollback.
- Проверить, что технические фильтры с `includeDescendants=true` или его отсутствием дают `400 VALIDATION_ERROR`; разрешённый exact-category случай не объединяет определения по `code` между категориями.
- Не выполнять реальные назначения catalog permissions, операторскую команду на рабочей БД, production migrations/deployment, удаление данных/томов или чужих ресурсов. Утверждённые ручные согласования остаются обязательными.
