# ADR-001: Prisma and migration ownership

Status: ACCEPTED by the owner in the R1-001 implementation assignment, 2026-10-21.

## Decision

Use Prisma ORM / Prisma Migrate **7.10.1**, pinned exactly. Version 7 is stable and supported; the npm `latest` tag currently points to Prisma 8 release candidates. Use the [version 7 documentation](https://www.prisma.io/docs/orm/v7) and [release policy](https://www.prisma.io/docs/orm/release-status).

`apps/api` is the sole owner of the PostgreSQL schema, Prisma configuration and ordered SQL migrations. Python and web cannot create migrations or write business tables. NestJS owns business transactions and permissions.

Development uses the explicit `db:migrate:dev` command (`prisma migrate dev`). Deployment uses a separate, operator-controlled `db:migrate:deploy` command (`prisma migrate deploy`). Neither command is called by startup, image entrypoints, health checks or automatic deployment. Review generated SQL and back up data before risky changes. Never reset an existing database without explicit approval.

## R1-001 boundary

Configure the datasource and CLI only. There are **no models, business tables, migrations, seeds or generated business client** in this task. Infrastructure readiness uses the PostgreSQL driver for `SELECT 1`; this exception cannot grow into a second business persistence layer. The first schema, generated Prisma client and migration tests belong to R1-002 after its schema contract is frozen.

## Consequences

Versioned SQL, one migration owner and reproducible tooling become mandatory. All future Prisma packages, including client/driver adapter, must use compatible pinned versions. R1-001 must not pretend that migration/RBAC tests exist before their implementation.
