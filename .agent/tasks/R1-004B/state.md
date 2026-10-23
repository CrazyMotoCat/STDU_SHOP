# R1-004B

TASK: R1-004B
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE_WITH_CHECKPOINT
PHASE: steps 2-5 additive schema/migration, permission/audit registry and isolated one-time permission initializer implemented; next slice is catalog HTTP vertical implementation
UPDATED_AT: 2026-10-24
BRANCH: codex/r1-004b-catalog-domain
BASELINE_MAIN: ab7f5a25a7d36d2d722e36effb8c9fecb848c88a
LAST_SAFE_COMMIT: 89a24b5
APPROVED_SOURCE_SHA: 8ae4dd8cfd15e3722d97259818b238924851c963
FROZEN_HEAD: 0a749af35e422f55be050bd256ea1e8639193541
CONTRACT_MERGE_SHA: 24c9653780c7e8dc511dd5acf1706ecdb9e191eb
CONTRACT_VERSION: FROZEN 1.0.0

## Authorization and scope

- Owner approval of OD-004A-01…11 and exact source SHA recorded on 2026-10-24 (Asia/Vladivostok). PR #7 merged; post-integration CI #31 (39970886845) passed on 24c96537 before this task began.
- Follow `docs/plans/R1-004B-implementation-plan.md` and `docs/contracts/R1-004B-test-matrix.md`: 9 catalog models, 12 new permissions, 31 operations (28 staff + 3 public), audit, revision workflow, bounded public reads, generated client and CATB-01…38 runtime evidence.
- FROZEN R1-002 1.0.0 and decisions #1–108 remain protected. One lead owns schema/migrations/OpenAPI/permissions; no parallel implementation writers are active in this worktree.
- Initial catalog permissions may be implemented/tested only on an isolated test DB. No execution of the operator command on a real working DB, real permission assignment, production migration/deployment or destructive operation is authorized.

## Completed start phase

- Created a feature branch after verified contract integration.
- Recorded SHA-256 hashes of frozen catalog/staff/decision artifacts and the existing Prisma schema/migration in `contract-lock.json`; text is normalized to UTF-8 LF to match Git and remain portable across Windows/Ubuntu.
- Added read-only `verify-contract-lock.mjs`; `--baseline` additionally checks pre-implementation Prisma files. This flag is a pre-migration guard, not a requirement for the final changed catalog schema.
- Added a CI trace gate that checks protected artifact hashes without `--baseline`, so intended Prisma implementation changes remain possible while frozen contracts stay locked.
- Added the scoped migration/runtime checklist and ownership/dependency plan in `docs/plans/R1-004B-start.md`.
- The additive nine-model catalog migration is implemented; the original R1-002 migration is unchanged.
- Migration/harness validation uses two owned disposable PostgreSQL 18.6 databases (fresh and populated). It verifies original R1-002 fixture/audit/file/permission rows unchanged, exactly 12 catalog Permission registry rows added, no RolePermission grants, accepted legacy/new audit events, and catalog constraints/workflow/locking/history invariants.
- Owner explicitly approved an additive extension of permission-list, current-permissions and role-permission enum schemas for the 12 catalog codes, while preserving the R1-002 control/full-admin permission sets. The R1-002 OpenAPI/client and contract-lock hash were updated to this narrowly authorized extension.
- Catalog permissions remain unassigned outside the disposable test database. The explicit one-time initializer is implemented; it has only been invoked by the isolated disposable PostgreSQL harness, never against the working database.

## Verification

- `node .agent/tasks/R1-004B/verify-contract-lock.mjs` — PASS: 19 protected artifacts; approved source preserved.
- `pnpm catalog:contract:check` — PASS: FROZEN metadata/provenance, reproducible validated 31-operation OpenAPI.
- `pnpm catalog:contract:test` — PASS, 44/44.
- `pnpm --filter @stdu/api db:validate` — PASS; Prisma client generated.
- `pnpm --filter @stdu/api exec node scripts/run-r1-004b-migration-check.mjs` — PASS on isolated PostgreSQL 18.6, fresh and populated fixtures; no persistent volume or external DB.
- The same isolated PostgreSQL harness also invokes the actual initializer CLI against its fresh disposable DB. Validation, eligible-target check, future-registry fail-closed, audit-failure rollback, exact 12-code role assignment, unchanged bootstrap role, and two concurrent one-time invocations all passed; exactly one concurrent command committed.
- `pnpm --filter @stdu/api typecheck`, `pnpm lint`, and `pnpm format:check` — PASS after the initializer slice.
- `pnpm contract:check` and `pnpm client:generate` — PASS after the owner-approved additive permission enum update; 23 existing staff operations remain stable and client generation is reproducible.
- Full lint/format/typecheck/test/build and end-to-end catalog runtime acceptance remain pending.
- Exact hosted CI is checked against the pushed Draft PR HEAD; links/results are recorded in the PR and delivery report.
- Existing main post-integration CI covers R1-002B runtime and foundation/UI smoke; it is not CATB-01…38 evidence.
- Catalog PostgreSQL/HTTP runtime CATB-01…38: NOT RUN. Independent database review of the schema/migration slice: PASS after four reviewed guard fixes. Backend and security implementation reviews remain pending; all are mandatory before R1-004B acceptance/merge.

## Next action

Next: implement the 28 staff and 3 public catalog HTTP operations, runtime OpenAPI/client consistency, and CATB PostgreSQL/HTTP checks. Preserve sorted root locks for relation replace/publish (CATB-34), keep R1-002 full-admin invariants unchanged, and retain this PR as Draft until CATB-01…38, independent backend/security/database review, exact-head CI and integration gates are complete.
