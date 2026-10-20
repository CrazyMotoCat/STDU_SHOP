# R1-001 — проверка и передача результата

Статус: реализация и проверки завершены на Windows и в Ubuntu CI. Приёмка владельцем — отдельный шаг.

Ветка: `feat/r1-001-foundation`. Исходный коммит задания: `d77b25d`. Обновление workflow, указанное владельцем: `be7079b`. Четыре утверждённых ADR и контракт сохранены в `43cbd3b` до реализации. Проверенный код: `d008f0a8d1eafc6800ee4ea55c414cf38a0b3462`. Локальная main сохранена на исходном коммите.

## Связь требований с доказательствами

| AC задания                   | Реализация / фактическая проверка                                                                                      | Результат                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Монорепозиторий           | apps/web, apps/api, services/ingestion, infra/compose, scripts; структура в README                                     | PASS                                                       |
| 2. Сборки                    | pnpm build: Next.js, NestJS, Python wheel + sdist; контейнерные сборки и smoke                                         | PASS Windows + Ubuntu                                      |
| 3. Пять компонентов Compose  | pnpm compose:up / compose:status; пять healthy сервисов на локальном Docker Desktop; CI smoke                          | PASS Windows + Ubuntu                                      |
| 4. PostgreSQL и Redis        | Реальные SELECT 1 / PING на каждом Nest readiness; положительные и отрицательные сценарии CI                           | PASS                                                       |
| 5. Доступность web/API       | HTTP 200 на 127.0.0.1:3000 и 127.0.0.1:3001/health/ready; проверка страницы в CI smoke                                 | PASS                                                       |
| 6. Health/readiness при сбое | smoke останавливает PostgreSQL и Redis по одному: API/web/ingestion ready=503, live=200, затем восстановление          | PASS Windows + Ubuntu                                      |
| 7. Python                    | uv locked sync, Ruff, mypy, pytest, wheel/sdist, FastAPI health в контейнере                                           | PASS Windows + Ubuntu                                      |
| 8. Lock-файлы                | pnpm install --frozen-lockfile; uv sync --project services/ingestion --locked; чистая установка в CI                   | PASS                                                       |
| 9. Независимый CI            | GitHub Actions run 39446797376, job 118710731152, точный SHA d008f0a                                                   | PASS; окончательный completion-коммит проверяется через PR |
| 10. Секреты вне Git          | .env.local игнорируется; сравнение staged diff с реальными случайными значениями без их вывода; проверка выдачи health | PASS                                                       |
| 11. Реальные инструкции      | README: два режима, конфигурация, порты, остановка; оба режима пройдены, host-процессы завершены smoke                 | PASS Windows + Ubuntu                                      |
| 12. Границы R1               | Независимое read-only ревью: PASS; нет бизнес-моделей, миграций, auth handlers, CRUD, заказов/склада/производства      | PASS                                                       |

Стек и инфраструктура соответствуют решениям №47–49; ADR файлов — №55 и архитектуре R1. Человеческие согласования №8/36/56/61/65/97 не автоматизированы. Реестр №1–108 сохранён. Уточнены только применимость quality gate (08), состав M1 (09), статус проектного API (06) и стартовые инструкции.

## Выполненные команды

- `pnpm install --frozen-lockfile` — PASS на Windows и чистом Ubuntu runner.
- `uv sync --project services/ingestion --locked` — PASS; 29 пакетов; повторная установка не меняет lock.
- `pnpm toolchain:check` — PASS: Node 24.19.0, pnpm 11.25.0, Python 3.14.3, uv 0.13.3.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck` — PASS для TS и Python на Windows и Ubuntu.
- `pnpm test` — PASS: 8 Vitest + 5 pytest, включая отрицательные readiness-сценарии.
- `pnpm build` — PASS: Next.js production, NestJS TypeScript, Python wheel/sdist.
- `pnpm db:validate` — PASS для datasource-only Prisma schema; бизнес-моделей и миграций нет.
- `pnpm smoke` — PASS Windows Docker Desktop + Ubuntu CI, включая отказ каждой зависимости и восстановление.
- `pnpm smoke:host` — PASS Windows PowerShell + Ubuntu CI, включая отказ каждой зависимости и завершение host-процессов.
- `git diff --check` и staged secret/artifact checks — PASS.

Локальные журналы: `.local/evidence/quality-windows.log`, `compose-smoke.log`, `host-smoke.log`; секретные значения не выводятся и журналы не добавляются в Git. Проверена запись/чтение API-пользователем в private-files без публичной раздачи. Скрипт PowerShell повторной инициализации сохраняет существующий env. После host smoke порты приложений освобождены.

## Hosted CI и независимое ревью

[Успешный run 39446797376](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39446797376) проверен ведущим и независимым QA через GitHub API: conclusion SUCCESS для `d008f0a8d1eafc6800ee4ea55c414cf38a0b3462`. Все шаги, включая оба failure smoke, восстановление и cleanup, завершены успешно. Окончательные проверки completion-коммита отображаются в [PR #2](https://github.com/CrazyMotoCat/STDU_SHOP/pull/2).

Первое ревью обнаружило ошибочный build context и незавершённые pnpm build approvals. Оба исправлены и повторно проверены. CI также выявил форматирование Python 3.14; исправление прошло повторный полный прогон. В Docker build добавлен OpenSSL для корректного Prisma CLI. Последнее ревью кода — PASS, без открытых HIGH/BLOCKER. При Windows host smoke Next.js создал вложенный AGENTS.md; штатная настройка agentRules=false отключила генерацию, файл удалён, web typecheck/lint и host smoke повторно прошли. Корневой AGENTS.md сохранён.

## Запуск и ограничения

Полные PowerShell-команды, адреса и дерево файлов — [README](../../README.md). Режим A: `pnpm compose:up`; остановка `pnpm compose:stop`. Режим B после остановки A: `pnpm dev`; Ctrl+C завершает приложения, `pnpm infra:stop` останавливает зависимости. `pnpm smoke:host` сам управляет жизненным циклом временных host-процессов.

Web/API публикуются только на loopback 3000/3001. Ingestion/PostgreSQL/Redis в полном Compose не имеют опубликованных портов. В host-режиме DB/Redis используют явно заданные 15432/16379: стандартный 5432 уже занят другим локальным проектом. Чужие контейнеры не останавливались. Тома не удалялись.

Не блокируют R1-001: предупреждение Starlette TestClient о будущей смене httpx и Node 20 metadata у pnpm/action-setup v4 (GitHub фактически выполняет его на Node 24). Все проверки с этими зафиксированными версиями прошли; обновления можно рассмотреть отдельной задачей поддержки.

NOT RUN / неприменимо к R1-001: бизнес-миграции и RBAC (реализация R1-002), release E2E-01…20, production VDS/TLS, внешнее резервное копирование/restore, антивирус/карантин и реальные поставщики. Они не заменены заглушками и остаются обязательными в соответствующих задачах/релизном gate. Новых секретов внешних сервисов, реквизитов или разрешений на парсинг не выдумано.

После приёмки владельцем использовать [шаблон ограниченной R1-002](R1-002-task.md). Реализация R1-002 и слияние в main не выполнялись.
