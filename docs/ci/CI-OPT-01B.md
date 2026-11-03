# CI-OPT-01B — Protected Main / CI Activation Preparation

Дата: 2026-11-04, Asia/Vladivostok. Режим: REVIEW_REQUIRED / SECURITY_GATE.

**Итог: BLOCKED для активации. Подготовка, benchmark и изолированные platform tests выполнены.** Владелец дополнительно разрешил merge PR40 при полной готовности; повторного разрешения на сам merge не требуется. Условие готовности пока не выполнено: platform proof подтвердил обход PR-controlled gate при подмене workflow, а первоначальная защита main подготовлена, но не применена.

## Исходники и текущий GitHub

- [PR40](https://github.com/CrazyMotoCat/STDU_SHOP/pull/40), HEAD `5d162a6e4a9a9c071d963939c96b36fd5d887904`, Draft, не объединён. Main/base: `59655a74ff4c815855eb416683c3c2db793c9af4`.
- Проверенный merge candidate: `eeb7e8b8f993aa96793caeaa02cc82c62fb22a17`.
- Main: authenticated `protected:false`; classic protection404 `Branch not protected`; rulesets[] и branch rules[]. **Legacy check на main пока НЕ mandatory.** Это не отсутствие API permissions: admin-доступ и запись trial protection фактически проверены.
- Collab API вернул только `CrazyMotoCat`, role admin. Независимого второго reviewer с write/admin нет. Фиктивные accounts/teams и CODEOWNERS не создавались. Авторы собственных PR не могут одобрять их сами.
- Actions settings: `default_workflow_permissions: read`, `can_approve_pull_request_reviews:false`. Настройки Actions не менялись.
- Разрешение этой фазы сформулировано как «подготовить безопасную активацию»; изменение main protection не выполнялось. Последующее условное разрешение merge40 не заменяет решение о trusted-policy схеме и APPLY подготовленных settings.
- PR39, ClamAV, Product Media, production, БД и FROZEN contracts не изменены.

## Исправление, найденное platform test

Исходный FULL job использовал `always()`. При отмене workflow старый job продолжал полный workload; отменённый planner также запускал дорогой fallback, задерживая следующий run. Это подтверждено во время смены тестовой base/head; загрязнённые duplicate samples исключены из benchmark.

В PR40 отдельным commit `5d162a6` условие заменено на `!cancelled() && (planner failed || full requested)`. Merge gate по-прежнему `always()` и требует FULL success; cleanup step сохраняет `always()`. Все прежние FULL steps сохранены. Добавлена regression-проверка, всего **68 policy tests PASS, zero skips**. Actionlint1.7.12, Prettier, diff hygiene — PASS. Независимые architecture, Security/merge-gate и QA reviews точного нового HEAD — PASS.

Hosted proof использовал буквально совпадающие с PR40 workflow/test files на изолированном HEAD `312fddf7a0d7e84cb9ced4d4c069b6c71b5f7a71`: [run41670877917, attempt2](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41670877917/attempts/2). Обычный cancel API202, без force-cancel: FULL cancelled, gate failure. По GitHub server Date и job timestamps FULL завершился через38s после запроса, gate — через55s. Часы локального хоста для этих интервалов не использованы. Изолированный merge после cancellation отклонён405. **P2 cancellation закрыт.**

## Exact-final-head CI PR40

| Workflow | Run                                                                               | Результат | Workload                                             | Создание run → конец последнего job |
| -------- | --------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- | ----------------------------------- |
| FAST     | [41667071323](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667071323) | SUCCESS   | JS64s / Python45s / contracts55s параллельно; gate9s | **80s (1:20)**                      |
| FULL     | [41667071363](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667071363) | SUCCESS   | FULL690s (11:30), plan14s, gate13s                   | **729s (12:09)**                    |
| Legacy   | [41667071705](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667071705) | SUCCESS   | **547s (9:07)**                                      | **554s (9:14)**                     |

Все относятся к HEAD5d162a6 и candidate выше. Проверены planner/FULL/merge-gate, а не только общий workflow conclusion. Сохранены FROZEN contract checks, PostgreSQL/Redis runtime, R1-002B/004B/006B/007B/010B/010C, UI smoke, catalog browser acceptance, five-service integration/dependency failures, host lifecycle x3, lint/format/types/test/build и unconditional cleanup. Unit baseline:118JS passed/96environment-gated skips,66Python passed/0skips; skipped units не выданы за выполненные runtime tests. Полный runtime действительно выполнен hosted.

## Защита: испытанная конфигурация и recovery

Испытывались только собственные `codex/ci-opt-01b-*` refs. Main не использовался как negative target. Базовый payload: [activation/main-protection.request.json](activation/main-protection.request.json).

- PR required, approval count0: разрешает единственному владельцу normal PR flow без невозможного self-review.
- Required check `quality-and-integration`, **GitHub Actions app15368**, strict up-to-date.
- Enforce admins true; force push/delete false; lock branch false; linear history false; no bypass allowances. Code-owner/last-push review не включаются до проверки реального reviewer path.
- Trial PUT200 → GET exact readback → DELETE204 → GET404 → PUT200 → GET200: admin recovery доказан.
- Direct push отклонён GH006 с причинами PR required и legacy expected; force-update422 `Cannot force-push`; delete422 `Cannot delete this branch`. Trial SHA не изменился. Это доказывает обязательность legacy на **trial base**, а не на main.
- Ready, conflict-free trial PR с count0 и успешными real legacy/FULL имел `mergeable_state:clean`. Положительный merge не выполнялся. Отказы ниже проверены фактическими expected-denial merge API запросами, строго только на trial PR42.
- Позже на trial добавлены FULL merge gate/FAST CI от15368; readback сохранил strict, admin enforcement, no-force/no-delete/count0. Existing rules другого владельца не заменялись: обе test rules созданы этой задачей.

## Platform acceptance: отрицательные случаи

Использованы только [PR41](https://github.com/CrazyMotoCat/STDU_SHOP/pull/41) и [PR42](https://github.com/CrazyMotoCat/STDU_SHOP/pull/42). Оба закрыты **без merge**. Полные SHA, candidate/base, контексты/App, ответы API и job timestamps находятся в [evidence JSON](activation/CI-OPT-01B-evidence.json).

| Сценарий                      | Фактическое evidence                                                                                                                  | Результат                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| FAST-only Draft               | Docs/CSS/catalog/parser-tests: FAST success, FULL skipped, настоящий gate failure                                                     | Ложного зелёного gate нет                                                            |
| Draft → Ready                 | Timeline ready_for_review; новый [FULL41667653498](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667653498), source2431059 | FULL success, не старый workflow                                                     |
| Новый HEAD после FULL success | После source2431059 появился3850f86; [41669846285](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41669846285)                | Старый success не принят; planner failure запустил FULL fallback, итоговый gate fail |
| Изменение base                | Защищённая base стала5b2f9f7, source5cc2915 прежний; strict readback                                                                  | `behind`; merge405, required contexts expected                                       |
| Отсутствующий FULL            | sourceca49238 удаляет workflow только в trial; gate отсутствует                                                                       | merge405, expected required check                                                    |
| Failed FULL                   | source2e013de, намеренная ошибка format; [41667082783](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667082783)            | FULL/gate failure; merge405                                                          |
| Skipped FULL на Ready         | source605a61b; [41667814989](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667814989), FAST success                        | Настоящий gate failure; merge405                                                     |
| Cancelled FULL                | exact fixed files, source312fddf, ordinary cancel attempt2                                                                            | FULL cancelled/gate failure; merge405                                                |
| Подменённый источник status   | Same-name personal/OAuth success, при real legacy/FULL success и required app15368                                                    | merge405: `was not set by the expected GitHub app`                                   |
| Подменённый workflow/gate     | source5cc2915 меняет вызов gate на echo, FULL job false                                                                               | **Обход подтверждён**, подробности ниже                                              |
| Сохранение rules              | Trial required contexts расширены; strict/admin/no-force/no-delete сохранены/readback проверен                                        | PASS на trial; main settings не применены                                            |

Ограничения причинной изоляции: в missing/failed/skipped/cancelled FULL snapshots legacy также pending или failed (в missing case FAST тоже failed). Ответы405 подтверждают отказ совокупной policy; они не выданы за изолированный отказ только одного FULL check. Wrong-App опыт изолирован: остальные требуемые checks были успешны, а ответ405 прямо назвал неверный App. Ready trial использовал уже критический backend diff, поэтому подтверждает реальный ready_for_review event/run, но отдельно не изолирует FAST-only diff → FULL; этот частный случай проверен локальным policy test. Эти ограничения сохраняются в итоговой оценке готовности.

**P1 trusted-policy: реальный обход.** [FULL41668263272](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41668263272) имеет FULL skipped, но fake gate success от правильного app15368. [FAST41668263468](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41668263468) также success. После успешного настоящего [legacy41668263410](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41668263410) все три required contexts были green, `mergeable_state:clean`. Merge не выполнялся. Legacy в этом эксперименте действительно выполнил полный набор; опыт показывает, что при его будущем снятии требуемый FULL gate может быть подделан. Pin App удостоверяет производителя check, но не подлинность PR-controlled workflow. Самотестирование не может исключить произвольную замену вызывающего workflow.

## Реальный benchmark

Это synthetic path-routing canaries, а не изменения бизнес-логики и не нагрузочные испытания parser/security. CSS — только комментарий в существующем catalog CSS; остальные canaries — неисполняемые Markdown в соответствующей области. Каждый выбранный PR diff содержит только текущую область: предыдущие canaries отменены обычными commits, history не переписывалась. Cases основаны на dd4b768; изменение5d162a6 касается только отмены job и отдельной policy-проверки, финальный source дополнительно проверен выше. Нормальный test workload не сокращался.

| Case / source                        | FAST run / elapsed                                                                           | FULL run / workload / elapsed                                                                           | До первого FAST job | Максимальный FAST job allocation delay |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| Docs a3ae0fd                         | [41661312160](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41661312160) / **90s**  | 41661312324 / skipped / gate fail                                                                       | 4s                  | 3s                                     |
| CSS1866c2cf                          | [41663085245](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41663085245) / **78s**  | 41663085345 / skipped / gate fail                                                                       | 3s                  | 3s                                     |
| Catalog17b5afb                       | [41663729974](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41663729974) / **89s**  | 41663729966 / skipped / gate fail                                                                       | 4s                  | 7s                                     |
| Parser tests4d2e2df                  | [41664261084](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41664261084) / **150s** | 41664261092 / skipped / gate fail                                                                       | 65s                 | 3s                                     |
| Parser implementation d0876f6, Draft | [41670418609](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41670418609) / **163s** | [41670418473](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41670418473) / **624s** / **693s** | 73s                 | 6s                                     |
| Backend/security2431059, Draft       | [41665780026](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41665780026) / **84s**  | [41665779753](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41665779753) / **572s** / **604s** | 3s                  | 4s                                     |
| Ready2431059                         | [41667653569](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667653569) / **95s**  | [41667653498](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41667653498) / **688s** / **724s** | 3s                  | 3s                                     |

В JSON сохранены полные source/base/tested SHAs, UTC timestamps, jobs/steps/results, job runtime и allocation delay (`started_at-created_at`). До первого job включает scheduling/concurrency до создания job и ожидание runner; эти интервалы не смешиваются с runtime. FAST elapsed измеряется от создания workflow до завершения aggregator. Parser-tests FULL plan дополнительно ожидал старый uncancellable run; загрязнённые duplicate/empty-diff samples не считаются отдельными успешными benchmarks.

Все FAST samples уложились в180s. Ранее измеренный legacy workload был679/643/682/1164s; текущий final-source legacy —547s, FULL —690s. Новый FULL в этом sample дольше legacy на143s; причины variance/cold-vs-warm не изолированы, ускорение FULL не заявляется. Cache state не контролировался. Legacy по-прежнему выполняется на каждом PR: **суммарное ускорение ожидания >=50% ещё не активировано и не доказано**.

## Trusted-policy: реализуемые решения

Сейчас независимый account отсутствует, CODEOWNERS не enforced. Нельзя назначить автора PR40 `CrazyMotoCat` собственным независимым approver. Два конкретных пути для решения владельца:

1. **Отдельный реальный reviewer.** Владелец выбирает существующий account человека, предоставляет согласованные write-права; затем проверить collaborator permission и CODEOWNERS eligibility. Только после положительного теста включать обязательное code-owner review CI-policy и dismiss stale approvals. Имена/права заранее не придумываются.
2. **Один human owner + bot-authored CI-policy PR.** Использовать существующий GitHub Actions App как автора через отдельно проверенный manual intake workflow на защищённой default branch; `CrazyMotoCat` становится human CODEOWNER/reviewer, а не автором таких PR. Intake только копирует Git tree/commit через API с pinned SHA, не выполняет PR-код; не выдаёт автоматических approvals. Все чувствительные изменения и CODEOWNERS должны требовать owner review по версии CODEOWNERS из base. Текущий repo flag создания/approval PR ботом выключен: изменение flag, intake и review rules требуют отдельного решения/положительного trial proof. По актуальной документации PR, созданные GITHUB_TOKEN, создают approval-required CI runs: owner должен разрешить workflows и отдельно проверить/одобрить итоговый SHA. Это план, **не активированная и не доказанная здесь схема**. Не включать правила, которые заблокируют существующие owner-authored CI PR без проверенного bot-пути.

Защищаемые области: `.github/workflows/**`, `.github/actions/**`, `scripts/ci/**`, все допустимые местоположения CODEOWNERS; package manifests/lockfiles, pnpm-workspace, toolchain.json, .node-version/.python-version, tsconfig*, eslint/vitest/Next configs, ingestion pyproject/uv.lock и связанные build/infra scripts. Реальный owner определяется выбранным путём. Установка одного CODEOWNERS файла без enforcing rules проблему не закрывает.

## Точные owner UI steps: первоначальный APPLY

1. Перед APPLY снова прочитать main protection/rulesets, SHA, required contexts/App и bypass. Если появились чужие active rules, остановиться и сохранить их: не заменять текущим payload.
2. Settings → Branches → Add branch protection rule, точное имя `main`. Require a pull request ON; обязательные approvals/code-owner/last-push review пока OFF (API approvals0), чтобы избежать self-approval lockout.
3. Require status checks ON: `quality-and-integration` от GitHub Actions app15368. Require branches up to date ON. Do not allow bypassing/включая administrators ON.
4. Allow force pushes OFF; allow deletions OFF; lock branch OFF; linear history OFF. Не добавлять bypass actors или фиктивных reviewers.
5. Сохранить и проверить authenticated readback против испытанного JSON. Только после этого legacy можно назвать mandatory на main. Проверенный admin recovery — редактирование/восстановление rule через Settings/API; отрицательные push/delete/merge тесты на main не выполнять.

## Последовательность перехода и рекомендация

1. Получить решение APPLY первоначальной защиты и выбрать trusted-policy путь. До этого main settings и code-owner requirements не менять. User authorization условного merge40 уже получено, но readiness сейчас BLOCKED.
2. После APPLY подтвердить exact source/candidate CI40, свежесть main, отсутствие конфликтов и блокирующих findings; выполнить owner-reviewed trusted-policy/bootstrap решение. Тогда normal merge commit PR40 допустим по уже полученной условной авторизации, без повторного запроса разрешения на сам merge. Сейчас merge не выполнен.
3. Проверить integrated merge SHA и post-merge legacy/FULL на main; никакого прямого исправления main при неуспехе. Затем потребовать `FAST CI` и `FULL merge gate` от app15368, сохраняя legacy mandatory и strict freshness. Включить выбранную независимую policy review/trusted enforcement схему с проверенным recovery.
4. Повторить forged-policy negative test: человеческий/trusted control должен блокировать изменение, которое выпускает fake green. Этот критерий сейчас **FAIL**, поэтому legacy retirement не готов.
5. Только после успешного proof открыть отдельный Draft PR отключения legacy на промежуточных Draft. Сохранить FULL для Ready/critical/new head и main; сначала доказать новые required gates, затем менять legacy requirement без окна отсутствия защиты. Сейчас такой PR не создавался: условие успешного proof не выполнено.
6. Rollback: сначала восстановить legacy как required и проверить полный CI текущего SHA, затем откатывать новый CI отдельным PR. Не отключать активный gate до зелёной замены; не менять production/DB или main напрямую. Initial APPLY ещё не сделан, поэтому main rollback этой фазе не требуется.

Findings: **P0 — нет; P1 — воспроизводимая подмена same-App gate и отсутствие активной main protection/trusted policy; P2 cancellation — исправлен и закрыт source+hosted proof; новых P2/P3 дефектов реализации нет.** Benchmark >=50% и FULL speedup не доказаны; это ограничения результатов, а не заявленные PASS. Тестовые PR закрыты, все6 task-owned trial refs и обе trial rules удалены после сохранения evidence; локальная история/worktrees сохраняются. Итоговый authenticated GraphQL read вернул `branchProtectionRules.nodes: []`: оставшихся classic rules нет. Отдельные trial rule DELETE receipts в cleanup не сохранялись; удаление подтверждено проверками статуса в cleanup script и этим итоговым inventory, а не вымышленными receipts.

## Первичные источники GitHub

- [Branch protection API](https://docs.github.com/en/rest/branches/branch-protection)
- [Protected branches и источники checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Workflow cancellation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)
- [CODEOWNERS из base branch](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Автор PR не может approve собственный PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [Actions permissions/create PR setting](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Актуальные approval-required PR workflows от GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
