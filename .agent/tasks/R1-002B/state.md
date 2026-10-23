# R1-002B

TASK: R1-002B
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: B2 — implementation and local acceptance complete; CI clean-run precondition fixed, final hosted CI pending
UPDATED_AT: 2026-10-23
BRANCH: codex/r1-002b-staff-identity
LAST_SAFE_COMMIT: 39bee0adb05035f70cd5f304c8a86210598b8df8
OWNER_APPROVED_SOURCE_SHA: 867184f60d5306b58dd66ac6607a6ec0487761d3
FROZEN_CONTRACT_COMMIT: bf0b66d06cca7a061c35d3f9e7af9a99f5f5ea57
CONTRACT_VERSION: 1.0.0

## COMPLETED

- Implemented the approved 11-model Staff Identity/RBAC/data foundation and all 23 frozen API operations, with generated client and semantic OpenAPI parity checks.
- Added transactional PostgreSQL migration, restricted runtime-role provisioning, session/authentication, authorization, audit, seller/file metadata foundations, and no bootstrap account or standard password.
- Added the T-01…T-40 runtime acceptance harness with isolated ephemeral PostgreSQL/Redis services, migration rollback/repeat-deploy preservation checks, database concurrency scenarios, and production/loopback browser scenarios.
- Fixed local smoke recovery to pause/unpause only the task-owned dependency. A stopped isolated PostgreSQL container loses its test-only tmpfs database; the previous stop/start outage probe could therefore not verify recovery.
- Fixed the API image build context to include the Prisma generation script.
- Independent read-only reviews: security PASS; backend PASS; database PASS after splitting runtime-role refusal cases into independent outbound-membership, inbound-membership, and ACL/ownership fixtures.

## VERIFIED

- Baseline: local branch was created from synchronized, clean `main`/`origin/main` at `9dad7297603460b835a76a2147d1fcf9bac96d03`; task-start checkpoint commit `d0851d20a2babcf8c396c9e07823410a0c76d0c7`.
- `pnpm toolchain:check`, `pnpm db:validate`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm build`: PASS on Windows.
- `pnpm test`: PASS, 32 Vitest passed and 27 integration/runtime tests skipped in the no-test-database invocation; Python pytest 5 passed.
- Frozen contract checker: PASS for 11 entities, 12 permissions, 23 operations, and 40 planned tests; `pnpm contract:check` semantic equality PASS; `pnpm contract:test` 7/7 PASS; frozen checker tests 30/30 PASS.
- T-20 typed client reproducibility: `pnpm client:generate` followed by `pnpm contract:check` and `openapi-typescript --check` PASS; generated client typechecks and generated schema is excluded from Prettier formatting.
- First PR CI attempt `39935174388` reached contract export on a clean checkout and failed because Prisma Client had not yet been generated. `contract:check` now runs `db:generate` before importing Nest; rerun is pending on the next exact HEAD.
- `pnpm test:r1-002b`: PASS, 27/27 runtime tests; isolated fresh and populated PostgreSQL migration checks passed, including rollback and sentinel/history preservation.
- `pnpm smoke`: PASS on Windows; web/API/ingestion readiness and PostgreSQL/Redis outage-recovery checks passed; task-owned Compose project stopped without deleting volumes.
- Three consecutive `pnpm smoke:host` runs: PASS on Windows; readiness, outage/recovery and bounded owned-process shutdown succeeded; following runs acquired the ports without conflict.
- T-33 scope review: exactly 11 frozen data entities and 23 API operations; no edits under `docs/spec` or frozen `docs/contracts`, no catalog/quote/order/warehouse/production domain implementation, and no human approval automation.
- `git diff --check` and staged diff check: PASS. Frozen contract artifacts and decisions #1–108 were not modified.
- No production database, migration, or deployment operation was performed or authorized.

## UNCOMMITTED

- Clean-checkout contract-generation fix in `scripts/contracts.mjs` and its checkpoint update. Main implementation is committed and pushed as `39bee0adb05035f70cd5f304c8a86210598b8df8`; PR #5 is open. No unrelated paths identified.

## BLOCKERS

- Independent reviews are complete with no blocking or material findings. The final CI rerun, exact-HEAD checks, and eligible AUTO_MERGE remain pending. Do not mark delivered until the current PR SHA and post-integration `main` SHA/CI are verified.

## NEXT_ACTION

Commit the clean-run contract fix and checkpoint; push the PR branch; wait for every required check on its exact HEAD; merge only when branch protection and all policy conditions are satisfied; verify `main` and post-integration CI. Do not apply production migrations or deploy.

## DO_NOT_REPEAT

- Do not redesign FROZEN 1.0.0 or modify approved OD-002A-01…08, business decisions #1–108, frozen schema/RBAC/API/security semantics, or implement new business domains.
- Do not reuse production credentials, write production data, deploy, or apply migrations outside isolated local/CI test databases.
- Do not stop unrelated Docker containers, delete user volumes, reset/clean the worktree, force-push, or bypass required checks/reviews.
