# CI-OPT-01C — Initial Main Protection Activation

**MAIN_INITIAL_PROTECTION: APPLIED**. Дата: 2026-11-04, Asia/Vladivostok. Режим REVIEW_REQUIRED / SECURITY_GATE; explicit owner decision APPLY INITIAL MAIN PROTECTION.

## Evidence применения

До изменения: main `59655a74ff4c815855eb416683c3c2db793c9af4`, protectedfalse, classic404, rulesets[], effective branch rules[], classic inventory[]. Чужих existing rules для перезаписи не было. Повторная проверка непосредственно перед записью подтвердила тот же main и отсутствие rules. Все7 открытых PR имели точное имя legacy context и App15368.

Один PUT `/repos/CrazyMotoCat/STDU_SHOP/branches/main/protection` вернул **HTTP200**, GitHub server Date `Tue, 03 Nov 2026 16:52:48 GMT` (02:52:48 2026-11-04 Asia/Vladivostok). Перед PUT один read-only preflight оборвался по timeout; запись ещё не была начата. После реального PUT не было повторной записи, DELETE или временного отключения main protection. Guard запрещает повтор APPLY после write_attempted, при uncertain response допускается только GET/reconciliation.

Отдельные GET protection и branch подтвердили:

| Параметр                                | Сохранённое значение                        |
| --------------------------------------- | ------------------------------------------- |
| main.protected                          | **true**                                    |
| Pull Request required                   | true (required_pull_request_reviews object) |
| Required legacy context                 | **quality-and-integration**                 |
| Expected source                         | **GitHub Actions App15368**                 |
| Strict/up-to-date                       | **true**                                    |
| Required approvals                      | **0**                                       |
| Enforce administrators                  | **true**                                    |
| CODEOWNER approval / last-push approval | false / false                               |
| Force push / deletion                   | false / false                               |
| Linear history / branch lock            | false / false                               |
| Bypass allowances / push restrictions   | отсутствуют / null                          |

**Legacy теперь mandatory на main**, включая administrators: только этот check закреплён как required, от app15368, со strict freshness. FULL/FAST gates не добавлялись в required и не выданы за trusted enforcement. Ordinary bypass не разрешён; admin может менять сами настройки, но не bypass действующие requirements при обычном push/merge. Настройка count0 не требует невозможного owner self-approval; CODEOWNER enforcement намеренно OFF.

Main после применения: `59655a74ff4c815855eb416683c3c2db793c9af4`, SHA неизменен. Blob `.github/workflows/ci.yml` до/после — `ede7c68367c64fb1f0db9ad070f865b93f4dfbab`: legacy workflow сохранён без изменений.

[Запрос](activation/CI-OPT-01C-request.json) и [полные before/write/after/verification API evidence](activation/CI-OPT-01C-evidence.json) сохранены без credentials. Сохранённый JSON включает live protection URL и classic rule inventory. Последующие состояния CI могут измениться; ниже точный snapshot проверки.

## Совместимость существующих PR

| PR  | Проверенный HEAD                           | Существующий legacy check    |
| --- | ------------------------------------------ | ---------------------------- |
| #40 | `5d162a6e4a9a9c071d963939c96b36fd5d887904` | completed/success (App15368) |
| #39 | `a767b0d453c2b5321dc9dd23a66ff21188897d62` | in_progress/None (App15368)  |
| #37 | `b7b29497ef519c952db0ed168de2a2f6cf2574f8` | completed/success (App15368) |
| #36 | `e248147cfcb2cb2ac200f9e14ea373b7668cb1e5` | completed/success (App15368) |
| #31 | `56c1f23d706429f97a274737f1fbce1277cbed47` | completed/success (App15368) |
| #29 | `f703e6e1a5460ae71b164cfd1983abb0c824b502` | completed/success (App15368) |
| #28 | `5c4b6f4ac3514b4155b4e8ec3e2cce2be9f9a0db` | completed/success (App15368) |

После APPLY все7 PR снова проверены: context `quality-and-integration` действительно существует и принадлежит App15368. Блокировки из-за ошибочного имени/source не обнаружено. PR39 во время snapshot выполняет legacy CI; его blocked состояние не выдано за ошибку конфигурации или успешную приёмку. Старые PR также могут требовать синхронизации из-за strict up-to-date; они не изменялись этой задачей.

PR40 Draft/open/unmerged, HEAD `5d162a6e4a9a9c071d963939c96b36fd5d887904` неизменен; его legacy SUCCESS. PR39 Draft/open/unmerged, HEAD `a767b0d453c2b5321dc9dd23a66ff21188897d62` неизменен. Никаких mutation API к PR или их веткам в этой задаче не было.

## Административное восстановление без destructive main tests

Текущий account `CrazyMotoCat` по authenticated repository API сохраняет admin=true; успешные PUT/GET подтверждают возможность нормального администрирования. Ранее в CI-OPT-01B на собственной изолированной trial rule проверен полный install→GET→DELETE204→GET404→restore→GET cycle. В CI-OPT-01C этот destructive recovery cycle на main **не повторялся**: actual main DELETE/direct push/force push/merge отрицательные тесты не выполнялись.

Recovery path владельца: Settings → Branches → main rule → Edit (либо owner Administration API), сначала прочитать актуальные settings и сравнить с сохранённым JSON, затем восстановить только одобренные значения. Не удалять rule и не убирать required legacy автоматически. Enforce admins не лишает владельца права редактировать branch protection. CODEOWNER/count1/branch-lock не включены; отдельный reviewer для восстановления настроек не требуется. Это подтверждение прав и ранее испытанного административного пути, а не утверждение о выполненном main recovery test.

## Trusted-policy B: отдельное предложение

[Bot-authored CI-policy PR + ручной CODEOWNER review владельца](CI-OPT-01C-trusted-policy-B-proposal.md) описывает реальных actors, минимальный trusted manual intake, область ownership, stale-review invalidation, trial acceptance, bootstrap и recovery без self-review lockout. Никакие CI-policy изменения не получают автоматического approval. Bot только автор; owner вручную разрешает CI и отдельно вручную APPROVE review на финальном SHA.

Предложение не реализовано/не активировано: CODEOWNERS, Actions settings, privileged intake, required approvals не менялись. Same-App forged gate из CI-OPT-01B остаётся причиной не включать неподтверждённый FULL gate вместо legacy. Новое задание владельца должно отдельно разрешить и проверить bot/review bootstrap перед обязательным CODEOWNER enforcement. Текущий PR40 owner-authored: при будущем CODEOWNER requirement нужен доказанный перенос в bot-authored review path или иной отдельно согласованный bootstrap, без обхода правил.

## Выполненные проверки и остановка

Фактически выполнены API preflight(main SHA/classic/rulesets/effective rules/GraphQL inventory/permissions/PR checks), guarded single PUT, отдельные GET/readback всех flags, сравнение main/workflow blob/PR40/PR39 до/после, повтор check-name/App inventory всех7 PR. Payload и итоговые request/readback evidence независимо проверены Security review (PASS); исправлен guard повторной записи. Форматирование/JSON/diff evidence проверяются перед commit. Код/CI workflows не менялись, app/runtime tests не требовались и не заявляются как новые запуски этой фазы.

Evidence хранится в отдельной ветке `codex/ci-opt-01c-initial-protection`; report-only branch не объединяется с main. PR40 не merge/Ready, legacy не отключён, required contexts не заменены, чужие PR/ветки/worktrees не изменены, production/DB не затронуты. После предоставления evidence — STOP.
