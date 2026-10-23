# R1-004B — старт по FROZEN 1.0.0

**Статус: IN_PROGRESS, выполнена трассировка контракта (шаг 1 плана). Дата: 2026-10-24 (Asia/Vladivostok). Режим: AUTO_MERGE.**

Владелец утвердил OD-004A-01…11 на SHA `8ae4dd8cfd15e3722d97259818b238924851c963`. FROZEN metadata HEAD: `0a749af35e422f55be050bd256ea1e8639193541`. [PR #7](https://github.com/CrazyMotoCat/STDU_SHOP/pull/7) объединён в `main` как `24c9653780c7e8dc511dd5acf1706ecdb9e191eb`; [постинтеграционный CI #31](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39970886845) прошёл до начала R1-004B. Базовый main с записью COMPLETE для R1-004A: `ab7f5a25a7d36d2d722e36effb8c9fecb848c88a`.

Нормативный объём задан [планом реализации](R1-004B-implementation-plan.md) и [матрицей CATB-01…38](../contracts/R1-004B-test-matrix.md). В этой стартовой фазе модель/миграции, каталогный runtime API и client не менялись; CATB runtime ещё не выполнялись.

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
2. **Schema + migration — следующий срез:** один lead writer владеет `apps/api/prisma/schema.prisma` и новой additive migration. Реализовать точные FK/RESTRICT/CHECK/index/trigger/lock guards из frozen модели, не меняя существующую staff migration.
3. **Permission/audit registry:** только 12 новых Permission registry rows без RolePermission assignment; append-only audit extension. Проверить сохранность существующих fixtures и неизменность защищённых R1-002 инвариантов.
4. **Module/workflow:** staff reference CRUD, immutable draft snapshots, OCC, submit и ручные publish/return/reject/archive, typed attributes, relation/file metadata — по утверждённым API и правам.
5. **Operator CLI:** реализация и проверки только на task-owned изолированной тестовой БД. Утверждение контракта не заменяет отдельное разрешение на реальную выдачу полномочий.
6. **Public projection + client:** exact published pointers, ON_REQUEST, category keyset pagination, точные technical filters из OD-004A-06, экспорт OpenAPI и воспроизводимый generated client.
7. **Runtime/review/CI:** тесты добавляются с каждым срезом; завершение требует всех CATB-01…38, независимых backend/security/database reviews и CI точного итогового HEAD/merge candidate.

Shared schema, migration ordering, OpenAPI, permissions и audit имеют одного владельца. Независимые reviewers работают read-only; write-параллелизм допускается только после стабилизации границ и на отдельных ветках/worktrees.

## Чеклист миграционного и runtime-доказательства

- До catalog migration на изолированной fresh/populated fixture проверить применённую R1-002 migration, количество/хеши контрольных строк и audit/session/file fixtures. Рабочая БД не используется как тестовая.
- Применить новую additive migration транзакционно; зафиксировать SQL stdout, таблицы, FK/CHECK/index/guard проверки и сохранность исходных fixtures. Не включать migration в app startup.
- Проверять HTTP через собранный Nest application с реальными cookie/Origin/CSRF/RBAC границами; считать успешными только фактически выполненные сценарии.
- Для гонок использовать две PostgreSQL сессии, barriers и подтверждение lock wait через `pg_stat_activity`/`pg_blocking_pids` до release; затем проверять committed state, audit и rollback.
- Проверить, что технические фильтры с `includeDescendants=true` или его отсутствием дают `400 VALIDATION_ERROR`; разрешённый exact-category случай не объединяет определения по `code` между категориями.
- Не выполнять реальные назначения catalog permissions, операторскую команду на рабочей БД, production migrations/deployment, удаление данных/томов или чужих ресурсов. Утверждённые ручные согласования остаются обязательными.
