# R1-002A — независимое ревью и проверка предложения

**Статус пакета: FROZEN. Версия: 1.0.0. Режим интеграции: AUTO_MERGE после явного owner approval.**

Baseline `ec109beacd8fa687b2c127f160fb961d540a4f3b`; ветка `codex/r1-002a-contract-freeze`. Только документация, machine-readable proposed contracts, documentation consistency checker и его CI step. Рабочая Prisma schema, migrations, auth/business code, ADR, registry№1–108 и production не меняются. Один ведущий владелец контрактов; reviewers READ_ONLY.

## Финальная фиксация FROZEN 1.0.0

**Итог A: COMPLETE / MERGED.** [PR #4](https://github.com/CrazyMotoCat/STDU_SHOP/pull/4) переведён Ready for Review и объединён обычным merge после всех gates. Owner approval и содержимое сохранены; production/B runtime implementation отсутствуют.

| Этап                     | Точный SHA / фактический CI                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Freeze commit            | bf0b66d06cca7a061c35d3f9e7af9a99f5f5ea57; [CI39778571232](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39778571232) SUCCESS attempt1                                           |
| Actual tested candidate  | ed03bfa5b28068672894e4af0ccf5bfca91884f0; tree91d800815ea413088d6bbf81d2c07cfde516cf90 equals freeze HEAD                                                                                |
| Integrated main          | 3075337058fb63262b59d64a725fbaa30def6b93; тот же tree; локальный main безопасно fast-forwarded                                                                                           |
| Post-integration main CI | [CI39779081785](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39779081785) SUCCESS attempt1; job119825394521 logs подтверждают checkout3075337058fb63262b59d64a725fbaa30def6b93 |

Оба новых CI выполнили frozen checker30/30,29 baseline Vitest/1 Windows-only skip,5 pytest,полный quality gate,Compose smoke+3 host smoke со штатной остановкой и сохранением volumes. На merge main повторно PASS сверка содержимого с approved source и checker. Локально полный gate30 Vitest+5 pytest, parser/type-generation/typecheck/reproducibility PASS. Никакой runtime B coverage из этого не следует.

После подтверждённой интеграции добавлены только completion/status и [старт R1-002B](R1-002B-start.md). Этот небольшой documentation commit доставляется DIRECT_MAIN с отдельным exact-SHA CI; окончательные SHA/run публикуются в PR #4 и итоговом сообщении после наблюдения SUCCESS. FROZEN artifacts после freeze commit не меняются.

2026-10-22 владелец явно утвердил все OD-002A-01…08, включая исправленный OD-002A-02, на точном SHA `867184f60d5306b58dd66ac6607a6ec0487761d3`. Утверждение и границы разрешения зафиксированы в [пакете решений](R1-002-contract-decisions.md) и checkpoint. Для этого источника [CI39775928280](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39775928280) SUCCESS attempt1; actual checkout39f4ad9a0eb0ddb2b61944e39f4e1ccdd4e83ff4 и равный tree854de6325646a55922a57185d2704caaf21473ad.

Фиксация меняет статусы/версии и provenance; схема, permissions/templates/invariants, DTO/routes/errors и политики безопасности не изменены. Ведущий выполнил `node .local/verify-r1002-freeze.mjs`: четыре JSON структурно идентичны утверждённому Git-содержимому после исключения только точных version/status/description metadata; четыре Markdown идентичны после точных замен header/provenance; все восемь строк OD совпадают. Evidence: ignored `.local/evidence/r1002-frozen-equivalence.json`. Изменений apps/services/scripts/infra/ADR/spec/зависимостей нет.

Checker теперь требует FROZEN1.0.0, включая OpenAPI x-contract-version и Markdown headers. Добавлены четыре отрицательных metadata-теста, всего30. Runtime B tests по-прежнему NOT IMPLEMENTED / NOT RUN. Обязательный CI окончательного freeze HEAD/actual checkout, merge SHA и post-integration CI фиксируются в PR #4 и финальном отчёте после наблюдения результата; исторические runs ниже не подменяют эти проверки. Production migration/deploy не разрешены.

## Историческое дополнительное ревью OD-002A-02 до утверждения

Исходный HEAD `e7807f60741785c1bc4b1c695d6542eb44c230e8`. Владелец запросил устранить потерю критических полномочий; пакет остаётся PROPOSED, REVIEW_REQUIRED. Прежняя защита только восьми control permissions позволяла access-operator уменьшить чужую роль с уникальным sellers.write/audit.read/files.metadata.read, после чего grant ceiling мог исключить восстановление через API.

Исправление: `fullAdminProtectedPermissions` явно содержит все 12 первоначальных действий. После каждого влияющего изменения сохраняется хотя бы один ACTIVE сотрудник с пригодными credentials и собственным union ACTIVE ролей, содержащим весь набор; одновременно сохраняется прежний control-admin инвариант. Один full-admin удовлетворяет обоим. Имена ролей, сессия и объединение прав разных сотрудников не определяют пригодность. Обычный шаблон access-operator переименован в access-admin: все восемь действий управления доступом, без подразумеваемых остальных четырёх.

Все writers состояния/назначений/permissions/credentials/readiness и будущего registry используют существующий advisory lock до чтения состояния в READ COMMITTED, проверяют результирующий union перед commit. Отказ LAST_ADMIN_REQUIRED откатывает строки/версии/сессии, исключает SUCCESS audit; обязательный DENIED audit отдельно, его сбой503. Bootstrap создаёт полного администратора, owner-recovery сохраняет readiness без выдачи прав или bypass. Будущие catalog/engineering/quote права не включаются автоматически. OD-002A-01 и 03…08 по существу не менялись; recovery синхронизирован с OD-002A-02.

| Проверка актуальной ревизии                        | Фактический результат                                                                                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documentation checker                              | PASS: 11 entities,12 permissions,23 operations,40 planned B tests; explicit full12 policy/lock/qualification/OpenAPI409 consistency                                                       |
| `node --test docs/contracts/check-R1-002.test.mjs` | 26/26 PASS;13 новых регрессий checker, включая full set/union/bypass/lock/future extension/bootstrap/OpenAPI error/test-row drift                                                         |
| External OpenAPI validation / TS probe             | PASS swagger-parser13.1.0; openapi-typescript7.13.0, declaration typecheck, repeated generation SHA256 identical                                                                          |
| Local Windows quality gate                         | PASS `pnpm toolchain:check`, `db:validate`, `lint`, `format:check`, `typecheck`, `test`, `build`;30 baseline Vitest +5 pytest. Active schema по-прежнему пустая, не проверка будущего SQL |
| Independent senior backend architect               | READ_ONLY PASS после повторной проверки; checker26/26, diff check. MEDIUM error/audit mismatch и LOW rename wording закрыты                                                               |
| Independent application security                   | READ_ONLY PASS после повторной проверки; checker26/26, diff check. Открытых замечаний нет                                                                                                 |
| Future runtime regressions T-35…T-40               | NOT IMPLEMENTED / NOT RUN: unique critical permission, block/readiness, multi-role union, two full-admins, concurrent loss, DB/session/audit atomicity                                    |

Дополнительные замечания reviewers исправлены: password/role операции объявляют409 LAST_ADMIN_REQUIRED, password DENIED audit registry содержит причину, checker требует ответ для всех затронутых операций; T-37 разрешает безопасное переименование без возможности обойти последующую проверку union. Изменения схемы/миграций/бизнес-кода/инфраструктуры отсутствуют. Новые пути — только contracts, связанный B plan, этот отчёт и checkpoint. Локальные logs: `.local/evidence/od02-*.log`.

Окончательные SHA/actual CI checkout/run этой ревизии публикуются в описании существующего [Draft PR #4](https://github.com/CrazyMotoCat/STDU_SHOP/pull/4) и итоговом сообщении после push и наблюдения завершённого CI; этот файл не подставляет собственный ещё не созданный SHA. Успех старых CI ниже не является проверкой обновлённого контракта. Merge запрещён до утверждения владельцем обновлённого HEAD; B не начиналась.

## Исторические проверки A до дополнительного ревью OD-002A-02

| Проверка                                 | Фактический результат                                                                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git status/fetch/main baseline/worktree  | PASS, clean expected baseline                                                                                                                                                                                          |
| `node docs/contracts/check-R1-002.mjs`   | PASS: 11 entities/12 permissions/23 operations/34 planned tests, internal references/closed DTO/CSRF/permission mapping                                                                                                |
| Structural OpenAPI validator             | PASS: node .local/contract-tools/validate.mjs; @apidevtools/swagger-parser13.1.0, OpenAPI3.0.3 structure/refs                                                                                                          |
| Generated TS declaration probe/typecheck | PASS: openapi-typescript7.13.0 -> ignored .local/evidence/r1-002a-schema.d.ts, root pnpm exec tsc --noEmit --skipLibCheck; repeated regeneration SHA256 identical                                                      |
| Negative contract mutations              | PASS: node --test docs/contracts/check-R1-002.test.mjs — 13 tests (valid baseline +12 corrupt contract copies); all intended rejects exit1                                                                             |
| Format/lint/typecheck/test/build         | PASS: pnpm toolchain:check, db:validate, lint, format:check, typecheck, test, build. Baseline30 Vitest +5 pytest; no business tests claimed. Current empty active schema validates, not proposed SQL.                  |
| Exact-head/actual PR candidate GitHub CI | PASS: [run39768392072](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39768392072), attempt1 SUCCESS; HEAD d525d3f311c22d32d31c2fc5556d838a296adcc4, actual checkout c078f1b2a1acc3065d52aafd6d20256afd9aed59. |
| Runtime B auth/RBAC/SQL migrations       | NOT IMPLEMENTED / NOT RUN — запрещено заданием A                                                                                                                                                                       |

External validation packages устанавливаются только в ignored `.local/contract-tools`, отдельно от workspace, root package/locks не меняются. Generator authoring scripts/logs тоже ignored; JSON/MD в PR — reviewable source contracts, checker воспроизводим без генератора. Swagger parser structural validation не выдаётся за доказательство runtime auth/SQL correctness.

## Независимые review роли

| Роль                          | Режим     | Статус                                                                      |
| ----------------------------- | --------- | --------------------------------------------------------------------------- |
| Senior backend architect      | READ_ONLY | PASS after affected re-review; checker PASS, no open findings               |
| Application security reviewer | READ_ONLY | PASS after affected re-review; checker PASS, no open findings               |
| Database reviewer             | READ_ONLY | PASS after affected re-review; static inspection only, no runtime SQL tests |

Все подтверждённые findings исправлены ведущим и повторно проверены соответствующими reviewers. Открытых замечаний нет. Reviewers не меняли файлы/состояние Git/инфраструктуру. Прежние попытки двух review ролей были прерваны лимитом; после восстановления выполнены полные независимые reviews заново, неполные попытки не выданы за PASS. PASS review не утверждает owner decisions.

## Owner gate

Открыты OD-002A-01…08 в [едином пакете](R1-002-contract-decisions.md). Merge и R1-002B не выполняются до явного принятия точного contract SHA владельцем. Домен/VDS/production secrets/реальные реквизиты не нужны для проверки предложения и не выдумываются. Production retention/backup/proxy benchmarking — отдельная эксплуатационная приёмка.

## Найденные и закрытые замечания

| ID        | Severity                              | Исправление / доказательство                                                                                                                                                                     |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SEC-01    | HIGH, initial interrupted review      | Login after Argon rechecks exact passwordHash/authVersion under StaffUser FOR UPDATE; changed snapshot generic401, no new session. OpenAPI/T27 match; final security/backend/DB review confirms. |
| BE-01     | MEDIUM                                | Removed unenforced roleIds response cap; FileMetadata versions also uncapped.                                                                                                                    |
| BE-02     | MEDIUM                                | Bootstrap requires explicit display-name with common validation; no guessed name from email.                                                                                                     |
| BE-03     | MEDIUM                                | Added normative finite R1-002-audit-registry.json for action/outcome/reason/null/changes keys and session revocation/recovery.                                                                   |
| SEC-02    | MEDIUM                                | All non-auth write responses are closed id/version MutationResponse; no read-field disclosure from mutation-only permission. T03 + checker negative.                                             |
| SEC-03    | MEDIUM                                | Separate own-password pre-Argon rate limits, Redis fail-closed,429/Retry-After, T10.                                                                                                             |
| AUD-01    | MEDIUM, found after registry addition | Every declared audited4xx reason representable in primary action DENIED registry; explicit mandatory vs bounded pre-handler audit boundary. Checker and mutation test enforce.                   |
| DB-01     | LOW                                   | Explicit first migration BEGIN/COMMIT + injected mid-DDL failure T15; no automatic Prisma transaction assumption.                                                                                |
| DB-02     | LOW                                   | First-migration sentinel in excluded fixture_sentinel schema, public target clean; target conflicts STOP. T17.                                                                                   |
| DOC-01    | LOW                                   | Permission regex in Markdown code span matches machine JSON; no formatting corruption.                                                                                                           |
| Precision | clarification                         | Fresh DB clock_timestamp after lock waits; serialized login cap; explicit last-admin recovery confirmation; separate runtime/operator DB identities.                                             |

## Воспроизводимые команды A

```powershell
node docs/contracts/check-R1-002.mjs
node --test docs/contracts/check-R1-002.test.mjs
pnpm toolchain:check
pnpm db:validate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Checker и его13 тестов исполняются в CI до typecheck. Для external parser/type-generation probe использовались отдельно установленные pinned packages в ignored .local/contract-tools (pnpm --dir .local/contract-tools install --ignore-workspace --ignore-scripts); workspace package/locks не изменены. Команды: node .local/contract-tools/validate.mjs; pnpm --dir .local/contract-tools exec openapi-typescript ../../docs/contracts/R1-002-staff.openapi.json --output ../evidence/r1-002a-schema.d.ts; pnpm exec tsc --noEmit --skipLibCheck .local/evidence/r1-002a-schema.d.ts. Probe output — типы, не staff client/runtime implementation.

Raw local gate logs: .local/evidence/r1-002a-*.log. Существующее Starlette/httpx warning не новое и не ошибка. Scope check git diff baseline по apps/services/scripts/infra/docs/adr/docs/spec/package/locks/toolchain/AGENTS показывает отсутствие изменений. Отдельный checker работает только с JSON/MD, не соединяется с БД/Redis/сетью и не применяет schema.

## Публикация для owner approval

[Draft PR #4](https://github.com/CrazyMotoCat/STDU_SHOP/pull/4), режим REVIEW_REQUIRED. Контрактный commit d525d3f311c22d32d31c2fc5556d838a296adcc4 и проверенный actual merge candidate c078f1b2a1acc3065d52aafd6d20256afd9aed59 имеют одинаковый tree48ba431721b5704e2b6cb1e6e66fc9d2b5b73588. CI checkout подтверждён job119789477160 logs.

Ubuntu CI: документационный checker PASS,13 Node tests PASS; baseline29 Vitest PASS/1 Windows-only skip и5 pytest PASS; полный quality gate, Compose smoke и3 последовательных host smoke PASS. Это baseline runtime, не staff auth implementation. Повторов failed CI не потребовалось.

Следующий evidence-only commit меняет только этот отчёт и checkpoint. Его окончательный SHA/actual candidate/run публикуются в PR description и итоговом сообщении после проверки CI; контрактные файлы остаются без изменений. Approval относится к актуальному HEAD PR, а не только к историческому candidate. main остаётся ec109beacd8fa687b2c127f160fb961d540a4f3b; ни merge, ни B не выполнены.
