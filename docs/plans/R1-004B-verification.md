# R1-004B — implementation verification

**Status:** implementation and local acceptance checks complete; exact-head GitHub CI and integration pending.

**Contract:** R1-004A Catalog Domain Contract FROZEN 1.0.0, approved source `8ae4dd8cfd15e3722d97259818b238924851c963`.

**Implementation source commit:** `66205477da0a7238f1e5c4529524646106b94fec`.

**Delivery mode:** AUTO_MERGE, within the owner-approved contract and Git Delivery Policy.

## Implemented scope

- Added the nine frozen catalog entities and an additive Prisma migration. The R1-002 migration and protected full-admin permission set remain unchanged.
- Implemented the 12 catalog permissions as an additive registry and permission enum extension. Catalog permissions remain unassigned in the working database; the one-time CLI was exercised only against disposable test databases.
- Added 28 staff and 3 public catalog operations, with runtime OpenAPI parity and reproducible generated TypeScript client.
- Implemented reference management, typed revision data, manual review/publication transitions, relation and file-metadata checks, public projections and bounded pagination within the frozen contract.
- Added isolated PostgreSQL migration, backup/restore, permission-initializer, compatibility and HTTP runtime coverage. No persistent volume, production database or production migration was used.

## Runtime and database evidence

`pnpm catalog:runtime:check` passed on Windows using task-owned ephemeral PostgreSQL 18.6 and Redis containers. Both fresh and populated databases accepted the additive migration; protected R1-002 fixtures remained unchanged. The populated database passed `pg_dump`/`pg_restore` sentinel comparison. The permission initializer passed input/eligibility/fail-closed checks, audit rollback, exact 12-code grant, preserved admin permissions, and concurrent one-time invocation checks.

The CATB HTTP/PostgreSQL suite passed **12/12 grouped Vitest tests**. It covers the applicable CATB-01…38 matrix across migration/initializer/runtime/contract checks. CATB-29 launched the pre-catalog API from `d6bed64ac2e1d21e7312230efc99cc782c5e7508` on the additive schema using the restricted `stdu_runtime` database role: readiness and CSRF returned 200; unauthenticated `/auth/me` returned 401. The API used the runtime role; fixture and lock-observer connections used a separate migration-owner URL.

## Local checks

| Command                                              | Result                                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm toolchain:check`                               | PASS — Node 24.19.0, pnpm 11.25.0, Python 3.14.3, uv 0.13.3                                                                                                         |
| `pnpm db:validate`                                   | PASS                                                                                                                                                                |
| `node .agent/tasks/R1-004B/verify-contract-lock.mjs` | PASS — 19 frozen artifacts; approved source preserved                                                                                                               |
| `node docs/contracts/check-R1-002.mjs`               | PASS — original 12 protected permissions, additive catalog enum, 23 R1-002 operations                                                                               |
| `pnpm contract:check` / `pnpm contract:test`         | PASS — OpenAPI/client reproducibility; 7/7 tests                                                                                                                    |
| `pnpm catalog:check`                                 | PASS — 31 frozen operations, route security/inventory, generated-client check                                                                                       |
| `pnpm catalog:contract:test`                         | PASS — 47/47                                                                                                                                                        |
| `node --test docs/contracts/check-R1-002.test.mjs`   | PASS — 32/32                                                                                                                                                        |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | PASS                                                                                                                                                                |
| `pnpm test`                                          | PASS — Vitest 39 passed, 39 skipped; ingestion pytest 5 passed                                                                                                      |
| `pnpm build`                                         | PASS — API, web, staff client and ingestion package                                                                                                                 |
| `pnpm ui:smoke`                                      | PASS — UI acceptance. The owned smoke process exceeded its graceful deadline and was forcibly closed within its bounded cleanup; no unrelated process was targeted. |
| `pnpm test:r1-002b`                                  | PASS — 26 passed, 1 skipped. The local T-25 loopback case skipped because ports 3000/3001 were already occupied; those processes were left untouched.               |
| `pnpm catalog:runtime:check`                         | PASS — isolated PostgreSQL/Redis and CATB HTTP runtime evidence described above                                                                                     |
| `git diff --check`                                   | PASS                                                                                                                                                                |

The first exact-head Ubuntu CI attempt, [run #41](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39994071093), failed after CATB-29 had completed its HTTP probes: the pre-catalog API closed after the harness sent SIGTERM with POSIX exit status 143, and the harness incorrectly treated every nonzero code as failed shutdown. The owned process closed before the grace deadline; this was an exit-status classification bug, not a timeout or orphan-process failure. The harness now accepts status 143 only when it requested SIGTERM and the process closed within the graceful bound; forced shutdown and other unexpected exit statuses still fail. Windows `pnpm catalog:runtime:check` passed again after this correction. A fresh exact-head Ubuntu CI run and post-integration CI remain pending.

## Independent reviews

- Backend: **PASS**, no blocker. Rechecked CATB-03 archive state/audit invariants, CATB-20 revision audit rollback evidence and CATB-29 compatibility startup.
- Database: **PASS**, no migration blocker. Confirmed migration grants and that application connections use `stdu_runtime`; test fixture/observer operations are separate.
- Security: **PASS**, no security blocker. Confirmed staff guard/CSRF/permission boundaries, protected 12-permission full-admin set, file object checks, transactional audit behavior, initializer constraints and public projections.

Security review recorded one non-blocking **P3** contract/runtime alignment note: public OpenAPI documents 503, while some unwrapped database errors in public read paths can surface as 500. No authorization or data-exposure blocker was found. This note does not change the frozen contract or expand this task.

## Delivery status

PR #8 remains Draft until the shutdown correction is pushed and exact-head CI succeeds. Then mark it ready, verify required GitHub rules/reviews/checks, merge only when eligible, and record the resulting `main` SHA plus post-integration CI. This verification does not authorize production migration, deployment, real catalog permission grants or destructive actions.
