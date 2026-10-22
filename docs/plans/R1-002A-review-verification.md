# R1-002A — независимое ревью и проверка предложения

**Статус пакета: PROPOSED. Версия: 0.1.0-proposed. Режим: REVIEW_REQUIRED.**

Baseline `ec109beacd8fa687b2c127f160fb961d540a4f3b`; ветка `codex/r1-002a-contract-freeze`. Только документация, machine-readable proposed contracts, documentation consistency checker и его CI step. Рабочая Prisma schema, migrations, auth/business code, ADR, registry№1–108 и production не меняются. Один ведущий владелец контрактов; reviewers READ_ONLY.

## Проверки A

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
