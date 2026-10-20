# R1-001 foundation contract

Status: FROZEN for this task on 2026-10-21, within the owner's approved assignment. Lead integrator owns all changes.

## Scope and ownership

Next.js web, NestJS API, internal FastAPI ingestion, PostgreSQL and Redis only. R1-001 has no business schema, migrations, queues/jobs, users, auth handlers, catalog CRUD or business approval automation. ADR-001 through ADR-004 record approved technical decisions. R1-002 owns persisted staff sessions/RBAC and the first business migration.

## Health HTTP contract

All three apps expose `GET /health/live` and `GET /health/ready`.

- Live: HTTP 200, JSON `{"status":"ok"}` when the process can serve requests. No dependency checks.
- Nest readiness: run bounded real `SELECT 1` and Redis `PING` probes on every request. HTTP 200 with `{"status":"ready","checks":{"postgres":"up","redis":"up"}}` only if both pass. Otherwise HTTP 503, status `not_ready`, each check `up` or `down`.
- Web and ingestion readiness: call the Nest readiness endpoint with a bounded timeout and no response caching. HTTP 200, `{"status":"ready"}`, only if Nest is ready. On connection error, timeout or non-200, HTTP 503, `{"status":"not_ready"}`.
- Errors never return exceptions, hosts, credentials, connection strings or stack traces. Readiness is diagnostic only; green probes never mean a business approval or release acceptance.

## Networking and environment

Root `.env.local` is explicitly loaded; `.env.example` documents keys without secrets. Local setup generates independent random database/Redis credentials. Containers override host connection URLs with service DNS names. Credentials never enter web client bundles.

Full Compose binds web `127.0.0.1:3000` and API `127.0.0.1:3001`. Ingestion, PostgreSQL and Redis have no published ports. Host development publishes PostgreSQL/Redis only at `127.0.0.1:5432/6379`; apps bind `127.0.0.1:3000/3001/8000`. Modes share the local project volumes but cannot run application processes concurrently on the same ports. Startup checks refuse port conflicts.

On a VDS put HTTPS reverse proxy in front of loopback web/API. The Compose file is a foundation, not evidence of production TLS, backups, complete auth or legal readiness.

## Applicable quality gate

Root `lint`, `format:check`, `typecheck`, `test`, `build` cover TS and Python. Integration smoke builds/starts all five services, checks real readiness, temporarily stops PostgreSQL and Redis separately, verifies 503 readiness and 200 liveness, then restores both. It uses only the task's local Docker project and never deletes volumes. Host-mode smoke checks the same apps on the host with Docker dependencies. CI uses clean locked installs and its own environment.

R1-001 has no migration/RBAC tests. These become mandatory when the corresponding code is introduced in R1-002. Release-wide E2E-01 through E2E-20 remain required for completed R1.
