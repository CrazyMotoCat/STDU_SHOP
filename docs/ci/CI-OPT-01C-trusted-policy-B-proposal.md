# CI-OPT-01C — предложение trusted-policy B

Статус: предложение, не реализация и не активированная защита. Первоначальная main protection применена отдельно; legacy остаётся обязательным. PR40 не объединён, CODEOWNER approval пока выключен.

## Реальные actors и граница доверия

Единственный подтверждённый human collaborator — `CrazyMotoCat` с admin/write. Реальный существующий bot actor — встроенный GitHub Actions App (`github-actions[bot]`, App15368); его способность создавать PR в этом репозитории ещё требуется разрешить и проверить. Сейчас repo setting `can_approve_pull_request_reviews:false`, default token permissions read. Ни эти настройки, ни CODEOWNERS, ни intake workflow в CI-OPT-01C не менялись. Bot — автор PR, **никогда не approver**. Ручной reviewer — владелец `CrazyMotoCat`, отличный от автора PR.

Нельзя считать pin App15368 доказательством подлинности workflow: CI-OPT-01B воспроизвёл fake-green gate от правильного App при skipped FULL. Независимые AI reviews полезны, но не являются ручным GitHub CODEOWNER approval владельца.

## Предлагаемый поток

1. В отдельной согласованной bootstrap-фазе подготовить и вручную проверить минимальный `workflow_dispatch` intake в защищённой default branch. Он принимает полный source SHA и ожидаемый base SHA, проверяет repository/ref/40-hex, актуальность base и область diff. Конфигурация workflow берётся из доверенной base; PR-код, локальные actions, install hooks и произвольные команды исходной ветки не исполняются. SHA передаются данными/env, а не вставляются в shell. Intake создаёт новую bot-owned ветку/commit с выбранным tree через API и Draft PR от bot; не копирует credentials/артефакты и не подменяет пользовательские ветки. Не использовать `pull_request_target` для запуска PR-кода.
2. Разрешить bot только минимальные `contents:write` и `pull-requests:write` в этом доверенном manual intake, если отдельное решение владельца позволит repo setting создания PR. Не расширять default permissions всех workflow. GitHub объединяет создание и approval PR в одном repo toggle; это потенциальная capability, **не разрешение выдавать approval**. В intake нет review/approve API, автоматического merge или списков bypass. Если нельзя изолировать эти права от непроверенного кода, остановиться и выбрать отдельный ограниченный GitHub App/реального reviewer; регистрацию нового App и secrets не выполнять без решения владельца.
3. Владелец сначала просматривает diff workflow/actions/build/dependency hooks и только затем разрешает выполнение workflow и отмечает PR Ready. По текущим GitHub docs PR `opened/synchronize/reopened`, созданный GITHUB_TOKEN, создаёт approval-required CI runs. Проверить это реально в trial: нельзя предполагать запуск или успех. Approve workflows разрешает запуск CI, **не является code review approval**.
4. CI выполняется на exact source/merge candidate с read-only PR token, без привилегированных secrets. Все обязательные legacy checks должны пройти. Владелец вручную оставляет APPROVE review после проверки окончательного diff, SHA и CI. Новый push обязан сбрасывать старое согласование; intake не обновляет PR автоматически после owner approval.
5. После успешного trial установить CODEOWNERS с настоящим `@CrazyMotoCat` для чувствительных областей и самого CODEOWNERS; проверять errors/eligibility API. Только затем отдельно включать обязательный CODEOWNER review и dismiss stale approvals. CODEOWNERS применяется из base branch: этот файл должен попасть в base через отдельно проверенную bootstrap-процедуру **до** включения enforcing requirement.

## Защищаемые области

`.github/workflows/**`, `.github/actions/**`, `scripts/ci/**`; `.github/CODEOWNERS`, корневой `CODEOWNERS`, `docs/CODEOWNERS`; `package.json` во всех workspace, lockfiles, pnpm-workspace, toolchain.json, .node-version/.python-version; tsconfig, eslint/vitest/Next config, ingestion pyproject/uv.lock, все build/infra/scripts, которые выполняет CI. Список уточняется по фактическому дереву при реализации. Неизвестные пути — FULL; ownership не заменяет routing.

## Как избежать self-review lockout

При включённом CODEOWNER requirement owner-authored policy PR (включая текущий PR40) не может получить approval самого автора. Поэтому до включения enforcement нужно доказать bot-author path и отдельно решить судьбу PR40: перенос проверенного exact tree в новый bot-authored PR с новыми SHA/CI/review либо иной явно согласованный bootstrap. **Не переписывать PR40 автоматически и не обходить правила для его merge.** Для обычных owner-authored PR без чувствительных изменений проверить, что approval count0 не создаёт лишнего требования; для policy PR owner approval обязателен. Дополнительный last-push approval включать только если доказан path, где владелец-reviewer не является последним pusher.

## Trial acceptance до изменения main review rules

- Bot действительно является автором PR, human owner — другим actor и допустимым reviewer. Создание PR не выдаёт APPROVE.
- Непросмотренный bot PR остаётся blocked без owner review, даже если все checks green.
- Same-App fake-green gate и изменение/удаление workflow/CODEOWNERS требуют owner approval; попытка self-approval bot/автором не принимается. Никакой бот не вызывает review APPROVE.
- Изменённый HEAD/base инвалидирует согласование и CI; stale review не разрешает merge. После ручного review и полного CI проверяется нормальная merge eligibility на изолированной base.
- Неверные inputs, source/base SHA, fork/ref, неизвестный diff и ошибки API fail closed. Нет privileged execution PR-кода, токенов в logs/artifacts и bypass actors.
- Recovery из текущего admin account проверяется на изолированных правилах. До доказательства положительного bot/review пути main CODEOWNER requirement остаётся OFF; legacy strict/App15368 остаётся mandatory.

Реализация, настройки Actions и CODEOWNERS enforcement потребуют отдельного задания владельца. CI-OPT-01C останавливается после evidence initial protection и этого предложения; PR40 merge, retirement legacy и deployment запрещены.

Источники: [GitHub CODEOWNERS/base branch](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners), [GITHUB_TOKEN workflow triggering/approval](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [review собственных PR](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request).
