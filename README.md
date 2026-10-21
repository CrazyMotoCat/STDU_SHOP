# STDU_SHOP — B2B Graphite & Petrol

Проект индивидуальной B2B-платформы для каталога инженерного оборудования, заявок, парсинга, инженерной проверки и коммерческих предложений.

**Сейчас:** инфраструктурный каркас R1-001. Next.js, NestJS, FastAPI, PostgreSQL и Redis; бизнес-функции следующих задач ещё не реализованы.

## Локальный запуск (Windows PowerShell)

Нужны Git, Docker Desktop с Linux engine, Node.js **24.19.0**, pnpm **11.25.0**, Python **3.14.3**, uv **0.13.3**. На Linux используются те же версии. Установка uv через Python также поддерживается корневыми командами, если `uv` отсутствует в PATH.

```powershell
npm install --global pnpm@11.25.0
python -m pip install --user uv==0.13.3
pnpm env:init
pnpm install --frozen-lockfile
python -m uv sync --project services/ingestion --locked
pnpm toolchain:check
```

`pnpm env:init` создаёт игнорируемый `.env.local` с независимыми случайными локальными паролями и не выводит значения. Повторный запуск сохраняет файл. Альтернатива в PowerShell: `.\scripts\init-local-env.ps1`. Не заменяйте существующий `.env.local` без резервной копии: пароль уже инициализированного PostgreSQL хранится в его томе. `.env.example` описывает ключи. Все корневые команды запуска явно загружают `.env.local`.

### Режим A: все пять компонентов в Docker

```powershell
pnpm compose:up
pnpm compose:status
Invoke-RestMethod http://127.0.0.1:3001/health/ready
pnpm smoke
pnpm compose:stop
```

`compose:up` собирает образы, запускает контейнеры в фоне и ждёт readiness. Web: <http://127.0.0.1:3000>; API: <http://127.0.0.1:3001>. PostgreSQL, Redis и ingestion не публикуют порты на хост. Остановка сохраняет тома и данные.

### Режим B: приложения на хосте, зависимости в Docker

Сначала остановите режим A. В одном терминале:

```powershell
pnpm infra:up
pnpm dev
```

Web: <http://127.0.0.1:3000>; API: <http://127.0.0.1:3001>; ingestion: <http://127.0.0.1:8000>. PostgreSQL/Redis доступны только через `127.0.0.1:15432/16379`; порты заданы явно в `.env.local`, чтобы не пересекаться с обычными локальными БД на 5432/6379. При изменении `POSTGRES_HOST_PORT`/`REDIS_HOST_PORT` согласованно меняйте порты в `DATABASE_URL`/`REDIS_URL`. Все три приложения работают с перезапуском при изменении исходников. Ctrl+C останавливает приложения; `pnpm infra:stop` останавливает зависимости. Занятые порты приводят к понятной ошибке; автоматического перехода на другой порт нет.

Для автоматической проверки этого режима без ручного управления длительными процессами:

```powershell
pnpm compose:stop
pnpm smoke:host
```

Smoke сам управляет процессами и завершает их после проверки; Docker-зависимости восстанавливает и оставляет запущенными. Режимы используют один локальный Compose project `stdu-shop-r1-001` и одни тома; одновременно запускать приложения двух режимов нельзя.

## Проверки

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm db:validate
pnpm smoke
```

Корневые lint/format/typecheck/test/build проверяют TypeScript **и** Python. `test` выполняет Vitest и pytest; `build` — компиляцию NestJS, production-сборку Next.js и Python wheel/sdist. `smoke` запускает полный Compose, проверяет настоящие `SELECT 1`/`PING`, останавливает PostgreSQL и Redis по очереди, проверяет readiness 503 при сохранении liveness 200 и восстанавливает зависимости. Запускайте smoke только в локальном development Docker context: он временно останавливает сервисы этого проекта. Тома не удаляются.

У всех приложений есть `/health/live` и `/health/ready`; [контракт](docs/contracts/R1-001-foundation.md) описывает точные ответы. Никакие секреты и строки подключения не возвращаются. При проблемах смотрите `pnpm compose:status` и логи конкретного контейнера; не публикуйте полный `docker compose config`, содержащий подставленные значения окружения.

GitHub Actions выполняет locked install, проверки обеих экосистем, сборки и оба smoke-сценария в чистом Ubuntu runner. Фактические результаты и ограничения — [отчёт R1-001](docs/plans/R1-001-verification.md).

## Структура

```text
apps/web/                    Next.js App Router + инфраструктурные health routes
apps/api/                    NestJS, readiness probes, Prisma config, StoragePort
services/ingestion/           внутренний FastAPI, uv.lock, pytest/Ruff/mypy
scripts/                     запуск, проверка toolchain, smoke, локальная конфигурация
infra/compose/               базовый Compose + override только для host development
docs/adr/                    четыре утверждённых ADR
docs/contracts/              зафиксированный контракт R1-001
docs/plans/                  фактическая проверка и шаблон R1-002
.github/workflows/ci.yml      независимый quality/integration gate
.agent/tasks/R1-001/          checkpoint задачи
```

## Один VDS

Базовый Compose публикует web/API только на loopback, остальные сервисы доступны внутри Docker-сети. Для реального запуска нужен HTTPS reverse proxy на VDS, собственная конфигурация секретов и проверенное внешнее резервное копирование PostgreSQL + `private-files`. Это конфигурационные шаги развёртывания; локальный запуск не доказывает их выполнение. [ADR-004](docs/adr/ADR-004-file-storage.md) описывает файловый том и восстановление. Миграции не запускаются автоматически; команды `db:migrate:dev` / `db:migrate:deploy` предназначены для будущей согласованной схемы R1-002.

После приёмки R1-001 используйте [ограниченное задание R1-002](docs/plans/R1-002-task.md).

## Начните отсюда

- [Быстрый старт](README_START_HERE.md)
- [Утверждённые границы R1](docs/spec/02_RELEASE_SCOPE.md)
- [Основное ТЗ](docs/spec/03_MASTER_TZ_R1.md)
- [Архитектура](docs/spec/04_ARCHITECTURE.md)
- [Реестр решений №1–108](docs/spec/01_DECISION_REGISTER.md)
- [Дорожная карта Codex](docs/spec/09_ROADMAP_BACKLOG.md)
- [Первый промпт Codex](docs/spec/INITIAL_CODEX_PROMPT.md)
- [Правила агентов](AGENTS.md)

Не реализуйте заказы, склад, закупки и производство как функционал R1; они запланированы для последующих релизов.
