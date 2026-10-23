# R1-004B

TASK: R1-004B
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: step 1 contract trace complete; next slice is additive schema/migration
UPDATED_AT: 2026-10-24
BRANCH: codex/r1-004b-catalog-domain
BASELINE_MAIN: ab7f5a25a7d36d2d722e36effb8c9fecb848c88a
LAST_SAFE_COMMIT: ab7f5a25a7d36d2d722e36effb8c9fecb848c88a
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
- No catalog runtime, schema migration, registry grant, generated client update or DB operation has been implemented/executed in this start phase.

## Verification

- `node .agent/tasks/R1-004B/verify-contract-lock.mjs --baseline` — PASS: 19 protected artifacts, 2 baseline files, 11 staff models; no DB connection/mutation.
- `pnpm catalog:contract:check` — PASS: FROZEN metadata/provenance, reproducible validated 31-operation OpenAPI.
- `pnpm catalog:contract:test` — PASS, 44/44.
- `pnpm db:validate`, `pnpm lint`, `pnpm format:check`, `git diff --check` — PASS. Prisma validation does not inspect or mutate a database.
- Exact hosted CI is checked against the pushed Draft PR HEAD; links/results are recorded in the PR and delivery report.
- Existing main post-integration CI covers R1-002B runtime and foundation/UI smoke; it is not CATB-01…38 evidence.
- Catalog PostgreSQL/HTTP runtime CATB-01…38: NOT RUN. Independent backend/security/database implementation reviews: NOT RUN; mandatory before R1-004B acceptance/merge.

## Next action

Lead writer implements approved additive catalog schema/migration and append-only permission/audit registry extension as the first implementation slice, verifies it on isolated fresh/populated fixtures, and obtains independent database review before proceeding through the remaining plan. Keep this PR Draft until implementation/runtime/review gates are complete.
