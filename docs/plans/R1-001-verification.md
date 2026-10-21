# R1-001 — проверка и передача результата

Статус: техническое ревью владельца подтвердило архитектуру, границы и 12 критериев R1-001. Две минимальные корректировки реализованы и повторно проверены на Windows. Окончательный CI и SHA документационного HEAD публикуются в [PR #2](https://github.com/CrazyMotoCat/STDU_SHOP/pull/2); слияние выполняет владелец.

Ветка: `feat/r1-001-foundation`. Исходный коммит задания: `d77b25d`. Обновление workflow, указанное владельцем: `be7079b`. Четыре утверждённых ADR и контракт сохранены в `43cbd3b` до реализации. Принятый ревью baseline: `bff6043d1bcadfe4cb234c811602211d18c87077`. **Финальный SHA кода исправлений: `ad43185a7852c5407a5f92ba738303694e9ee4e5`.** Следующий коммит обновляет только этот отчёт и checkpoint; окончательный SHA передачи и CI зафиксированы в PR. Локальная main сохранена на исходном коммите.

## Связь требований с доказательствами

| AC задания                   | Реализация / фактическая проверка                                                                                      | Результат                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1. Монорепозиторий           | apps/web, apps/api, services/ingestion, infra/compose, scripts; структура в README                                     | PASS                                                |
| 2. Сборки                    | pnpm build: Next.js, NestJS, Python wheel + sdist; контейнерные сборки и smoke                                         | PASS Windows + Ubuntu                               |
| 3. Пять компонентов Compose  | pnpm compose:up / compose:status; пять healthy сервисов на локальном Docker Desktop; CI smoke                          | PASS Windows + Ubuntu                               |
| 4. PostgreSQL и Redis        | Реальные SELECT 1 / PING на каждом Nest readiness; положительные и отрицательные сценарии CI                           | PASS                                                |
| 5. Доступность web/API       | HTTP 200 на 127.0.0.1:3000 и 127.0.0.1:3001/health/ready; проверка страницы в CI smoke                                 | PASS                                                |
| 6. Health/readiness при сбое | smoke останавливает PostgreSQL и Redis по одному: API/web/ingestion ready=503, live=200, затем восстановление          | PASS Windows + Ubuntu                               |
| 7. Python                    | uv locked sync, Ruff, mypy, pytest, wheel/sdist, FastAPI health в контейнере                                           | PASS Windows + Ubuntu                               |
| 8. Lock-файлы                | pnpm install --frozen-lockfile; uv sync --project services/ingestion --locked; чистая установка в CI                   | PASS                                                |
| 9. Независимый CI            | Baseline bff6043: run 39449637262; окончательный HEAD и отдельный повторный CI — в Checks и отчёте PR #2               | PASS baseline; результат окончательного HEAD — в PR |
| 10. Секреты вне Git          | .env.local игнорируется; сравнение staged diff с реальными случайными значениями без их вывода; проверка выдачи health | PASS                                                |
| 11. Реальные инструкции      | README: два режима, конфигурация, порты, остановка; оба режима пройдены, host-процессы завершены smoke                 | PASS Windows + Ubuntu                               |
| 12. Границы R1               | Независимое read-only ревью: PASS; нет бизнес-моделей, миграций, auth handlers, CRUD, заказов/склада/производства      | PASS                                                |

Стек и инфраструктура соответствуют решениям №47–49; ADR файлов — №55 и архитектуре R1. Человеческие согласования №8/36/56/61/65/97 не автоматизированы. Реестр №1–108 сохранён. Уточнены только применимость quality gate (08), состав M1 (09), статус проектного API (06) и стартовые инструкции.

## Выполненные команды

- `pnpm install --frozen-lockfile` — PASS на Windows и чистом Ubuntu runner.
- `uv sync --project services/ingestion --locked` — PASS; 29 пакетов; повторная установка не меняет lock.
- `pnpm toolchain:check` — PASS: Node 24.19.0, pnpm 11.25.0, Python 3.14.3, uv 0.13.3.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` — PASS для TS и Python на Windows и Ubuntu.
- `pnpm test` — PASS Windows после исправлений: 14 Vitest + 5 pytest, включая шесть новых регрессионных тестов скриптов и отрицательные readiness-сценарии.
- `pnpm build` — PASS: Next.js production, NestJS TypeScript, Python wheel/sdist.
- `pnpm db:validate` — PASS для datasource-only Prisma schema; бизнес-моделей и миграций нет.
- `pnpm smoke` — PASS Windows Docker Desktop + Ubuntu CI, включая отказ каждой зависимости и восстановление.
- `pnpm smoke:host` — PASS Windows PowerShell + Ubuntu CI, включая отказ каждой зависимости и завершение host-процессов.
- `git diff --check` и staged secret/artifact checks — PASS.

Локальные журналы: `.local/evidence/quality-windows.log`, `compose-smoke.log`, `host-smoke.log`; секретные значения не выводятся и журналы не добавляются в Git. Проверена запись/чтение API-пользователем в private-files без публичной раздачи. Скрипт PowerShell повторной инициализации сохраняет существующий env. После host smoke порты приложений освобождены.

## Минимальные исправления после технического ревью

- `scripts/ops.mjs`: из composeUp удалена проверка свободного 8000; проверяются только опубликованные 3000/3001. В host dev и host smoke проверки 3000/3001/8000 сохранены.
- `scripts/lib.mjs`: успешное/неуспешное завершение обрабатывается на close после закрытия stdio; общий guarded finish и once handlers предотвращают повторную обработку error/close. Потоки декодируются в UTF-8 с сохранением символов между chunks; существующий trim возвращаемой строки сохранён. Содержимое stderr не публикуется.
- `scripts/lib.test.mjs`, `scripts/ops.test.mjs`, Vitest include: шесть проверок — stdout после exit, split UTF-8, error→close, nonzero exit без утечки stderr, настоящий дочерний Node с 256 KiB stdout и выбор портов Compose. Первый тест объединяет late stdout и split UTF-8; всего шесть тестов.
- В backlog добавлены будущие OpenAPI generation/contract CI (R1-002), политика сохранения/восстановления Redis jobs до очередей ingestion и актуализация README_START_HERE. Их реализация не начата.

Повторные проверки Windows:

- `pnpm exec vitest run scripts/lib.test.mjs scripts/ops.test.mjs` — PASS, 6 тестов.
- `pnpm toolchain:check`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:validate` — PASS, `.local/evidence/review-quality-windows.log`.
- `pnpm exec node .local/evidence/review-compose-port.mjs` — PASS: временный task-owned listener занимает 127.0.0.1:8000; requireFreePort отклоняет его, а полный smoke (`node scripts/smoke.mjs compose`, тот же entrypoint, что pnpm smoke) проходит. Listener закрыт в finally. Журнал: `.local/evidence/review-compose-smoke.log`.
- `pnpm compose:stop`, затем `pnpm smoke:host` — PASS с exit 0, включая оба отказа, восстановление и завершение приложений; `.local/evidence/review-host-smoke.log`. Сообщения exit 1 дочерних процессов после PASS относятся к управляемой остановке, не к результату smoke.
- Git diff/staged secret-value checks — PASS; бизнес-код, схема БД, конфигурация очередей и реестр №1–108 не менялись.

## Hosted CI и независимое ревью

[Успешный baseline run 39449637262](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39449637262) и HEAD bff6043 независимо подтверждены техническим ревью владельца: 8 Vitest, 5 pytest и оба smoke. PR workflow выполнялся на merge 54c9bfa25ab464999e42a32ec0f112a749cbad6f; его Git tree совпадал с bff6043 (351745ad99f31be6386dec4ff3b3b464bd8fdf3d). Это baseline, а не доказательство проверки новых исправлений. Повторный run окончательного HEAD, фактический checkout SHA и результат публикуются отдельно в [PR #2](https://github.com/CrazyMotoCat/STDU_SHOP/pull/2).

Первое ревью обнаружило ошибочный build context и незавершённые pnpm build approvals. Оба исправлены и повторно проверены. CI также выявил форматирование Python 3.14; исправление прошло повторный полный прогон. В Docker build добавлен OpenSSL для корректного Prisma CLI. Последнее ревью кода — PASS, без открытых HIGH/BLOCKER. При Windows host smoke Next.js создал вложенный AGENTS.md; штатная настройка agentRules=false отключила генерацию, файл удалён, web typecheck/lint и host smoke повторно прошли. Корневой AGENTS.md сохранён.

## Запуск и ограничения

Полные PowerShell-команды, адреса и дерево файлов — [README](../../README.md). Режим A: `pnpm compose:up`; остановка `pnpm compose:stop`. Режим B после остановки A: `pnpm dev`; Ctrl+C завершает приложения, `pnpm infra:stop` останавливает зависимости. `pnpm smoke:host` сам управляет жизненным циклом временных host-процессов.

Web/API публикуются только на loopback 3000/3001. Ingestion/PostgreSQL/Redis в полном Compose не имеют опубликованных портов. В host-режиме DB/Redis используют явно заданные 15432/16379: стандартный 5432 уже занят другим локальным проектом. Чужие контейнеры не останавливались. Тома не удалялись.

Не блокируют R1-001: предупреждение Starlette TestClient о будущей смене httpx и Node 20 metadata у pnpm/action-setup v4 (GitHub фактически выполняет его на Node 24). Все проверки с этими зафиксированными версиями прошли; обновления можно рассмотреть отдельной задачей поддержки.

NOT RUN / неприменимо к R1-001: бизнес-миграции и RBAC (реализация R1-002), release E2E-01…20, production VDS/TLS, внешнее резервное копирование/restore, антивирус/карантин и реальные поставщики. Они не заменены заглушками и остаются обязательными в соответствующих задачах/релизном gate. Новых секретов внешних сервисов, реквизитов или разрешений на парсинг не выдумано.

После приёмки владельцем использовать [шаблон ограниченной R1-002](R1-002-task.md). Реализация R1-002 и слияние в main не выполнялись.
