# R1-001 verification record

Status: IN PROGRESS. The following is a traceability plan, not a PASS claim.

Owner assignment: implementation approved on 2026-10-21. Base d77b25d; owner-mentioned workflow update be7079b; branch `feat/r1-001-foundation`. Contract freeze commit `43cbd3b` precedes application code.

| AC                                   | Evidence command / implementation                                     | Current result                          |
| ------------------------------------ | --------------------------------------------------------------------- | --------------------------------------- |
| 1 Monorepo structure                 | apps/web, apps/api, services/ingestion, infra/compose, root manifests | Files created; runtime checks pending   |
| 2 Service builds                     | pnpm build; Compose image builds through pnpm smoke                   | NOT RUN yet                             |
| 3 All five Compose services          | pnpm compose:up; pnpm compose:status                                  | NOT RUN yet                             |
| 4 Real PostgreSQL/Redis connectivity | Nest readiness SELECT 1/PING, pnpm smoke                              | NOT RUN yet                             |
| 5 Local web/API addresses            | HTTP checks in smoke; README URLs                                     | NOT RUN yet                             |
| 6 Failure readiness/liveness         | smoke stops each dependency, verifies 503/200, restores               | NOT RUN yet                             |
| 7 Python works and passes checks     | uv locked sync; Ruff/mypy/pytest/build; internal health probe         | NOT RUN yet                             |
| 8 Reproducible lock files            | pnpm install --frozen-lockfile; uv sync --locked                      | Install in progress                     |
| 9 Independent CI                     | .github/workflows/ci.yml, hosted Actions run on final SHA             | NOT RUN yet                             |
| 10 Secrets excluded from Git         | ignored generated .env.local; staged secret-value comparison          | NOT RUN yet                             |
| 11 Real startup instructions         | README, both smoke modes                                              | Instructions written; execution pending |
| 12 R1 boundaries preserved           | four ADRs, no business models/migrations/endpoints; read-only QA      | Review pending                          |

The business release tests E2E-01…20, business migration tests, RBAC, off-site restore, domain/TLS and real provider credentials are outside this foundation verification. They remain required at their assigned tasks/release gate.
