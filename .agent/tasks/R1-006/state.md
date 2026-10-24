# R1-006 checkpoint

TASK: R1-006 Catalog CSV/XLSX Import (R1-006A contract + R1-006B implementation)
STATUS: IN_PROGRESS
PHASE: R1-006B final verification and Git delivery
CHECKPOINT_STATUS: R1-006A is frozen and merged; R1-006B implementation and local gates pass; hosted CI and integration pending
LAST_SAFE_COMMIT: a8960c4cc61909cb0ed2daed57c4874a456e9b2a
BRANCH: codex/r1-006b-catalog-import

## R1-006B CURRENT STATUS (2026-10-24)

- R1-006A FROZEN contract remains unchanged. Feature branch started from merged R1-006A main commit `d097a751b24d4cc47c7ab4e589ff4eeb4044e916`; fetched and fast-forwarded to current `origin/main` `a8960c4cc61909cb0ed2daed57c4874a456e9b2a` (PR #13) before final checks. Public-catalog changes from PR #13 did not conflict with the import implementation.
- Implemented the approved R1-006B vertical slice: private CSV/XLSX upload and storage, isolated FastAPI parsing, raw preview, per-sheet mapping with fixed ACTIVE category/brand, normalized/deduplicated candidates, per-row decisions, DRAFT-only create/revision, audit/RBAC/OCC/idempotency, and protected Staff UI. No automatic publication, batch acceptance, catalog/warehouse/order/production expansion, production migration/deployment, or live permission grant.
- Approved slug fallback: generated from product display name plus UUID suffix, as explicitly selected by the owner; no change to frozen API contract.
- Local verification on Windows: `pnpm test:r1-006b` PASS (dedicated disposable Compose project; no named volumes); `pnpm catalog:runtime:check` PASS (fresh/populated PostgreSQL, permission initializer, CATB runtime and dump/restore checks); `pnpm db:validate`, ESLint, Prettier, workspace typecheck/build, Vitest (45 passed, 43 skipped), Python Ruff/mypy (including Windows target)/pytest (15 passed), R1-002 and R1-004 contract gates, R1-006 frozen-contract tests (7/7) and OpenAPI type generation PASS; `git diff --check` PASS.
- Independent backend, database, and security read-only re-reviews: PASS. Database review confirmed actor/reason-bound audit triggers, private source-file locking, schema-qualified trigger references, and Prisma/migration consistency. Security review confirmed owner-scoped import visibility, reference permission checks, and preservation of APPLIED/REJECTED rows on re-preview.
- Host environment uses Node 24.22.1 while repository pins 24.19.0; `uv` is not installed on the host. Python quality was executed through the repository's locked `services/ingestion/.venv`; exact pinned toolchain and full integration smokes remain delegated to hosted CI. The shared Compose smoke was not run locally to avoid touching shared ports/containers.
- Next: inspect final full diff, commit and push only task-owned paths, open Draft PR, then make it Ready and merge only after exact-HEAD hosted checks and repository rules succeed. Never apply production migrations or deploy.

The `COMPLETED` and `VERIFIED` sections below are historical R1-006A contract-delivery evidence; they do not describe R1-006B completion.

## COMPLETED

- Read the R1-006 assignment, project instructions, repository-state-guard, efficient-orchestrator and task-checkpoint guidance.
- Verified local main was clean and exactly matched fetched origin/main at 1efc7388971fdbdbe0ccad54efa2c9f3370785d0.
- Verified Draft PR #10 remains separately open/draft; no shared homepage or creative files were edited.
- Read CAT-02/CAT-05, R1-006 backlog row, decisions #6/#25/#56, domain/API/security/test specifications, FROZEN R1-002/R1-004 contracts and current storage/ingestion boundaries.
- Prepared a proposed data model/API/security/mapping/test contract and owner decision packet. No application code, Prisma schema, migration, RBAC registry or frozen artifact has been changed.
- Resumed safely from the expected docs-only dirty state on the recorded branch; fetched origin/main again and confirmed it remains at the baseline.
- Completed the R1-006A proposal across three DB entities, eight staff operations, raw source preview, private bounded parser interface, mapping, idempotency, manual row decisions, audit and tests. Added owner decisions OD-006A-01…05. No R1-002/R1-004 artifact, business code, migration, API implementation or permission registry was changed.
- Corrected R1-006A after technical review: removed CSV options from mapping schema, added per-sheet fixed ACTIVE category/brand semantics, narrowed raw-import visibility and reference reads, aligned conflict persistence/409/audit/rollback/retry behavior, and specified NDJSON terminal/truncation behavior plus OD-006A-01…05 clarifications.
- Added focused contract regression coverage. No application code, migrations, frozen RBAC/API artifacts, or business decisions #1–108 changed.
- Committed the consolidated R1-006A contract correction package as `7a9bd5ec94e072716c99c15846c28c540e21fbaf` and updated existing Draft PR #12. At resume, PR #12 was open, Draft, unmerged, and at HEAD `66c2a35d06f3e50e77fe7de2e390906677e0ebe7`.
- Confirmed GitHub Actions run `40065800880` failed at `pnpm format:check`; local Prettier reproduced the failure on `docs/contracts/R1-006-test-matrix.md`. Applied Prettier-only formatting and verified normalized matrix text is unchanged.
- Owner approved R1-006A proposal version 0.1.0-proposed on exact SHA `dab9e7902b3798c21376ce8bb91c965a67c80b2a`, including OD-006A-01…05.
- Merged `origin/main` `581cef81f7db7eb6141bdeeee6a997ab6c185339` into this branch as `8e43baf3d2b16ec46475dbf7f8c17563e183b88f`. SHA-256 of all seven approved artifacts matched before and after main integration.
- GitHub Actions run `40068352830` on pre-freeze SHA `dab9e7902b3798c21376ce8bb91c965a67c80b2a` — SUCCESS; final freeze/integration candidate still requires checks.
- Recorded owner approval and FROZEN 1.0.0 metadata. Added a checksum manifest that pins the exact approved pre-freeze hashes and the resulting frozen artifact hashes; contract checker enforces both sets and OD IDs.

## VERIFIED

- git status/log/diff/untracked/worktree/branch preflight — main clean; two unrelated R1-003V worktrees remain untouched.
- git fetch origin; HEAD equaled origin/main before branch creation.
- Read the attached R1-006 prompt from the user-provided attachment path.
- `python` JSON parse for all three machine-readable artifacts — PASS.
- `@apidevtools/swagger-parser` validation of R1-006 OpenAPI — PASS.
- R1-006 cross-contract script: 8 unique operations, 3 entities, aligned states/permissions/audit — PASS.
- `pnpm exec openapi-typescript docs/contracts/R1-006-catalog-import.openapi.json --output .local/contracts/r1-006-import-schema.d.ts` and `pnpm exec tsc --noEmit --skipLibCheck .local/contracts/r1-006-import-schema.d.ts` — PASS.
- Focused Prettier check for all task documents — PASS.
- `pnpm contract:check` — PASS; frozen R1-002 OpenAPI semantic equality (23 operations), generated client reproducibility.
- `pnpm contract:test` — PASS, 7/7.
- `pnpm catalog:contract:check` — PASS; FROZEN R1-004 artifacts consistent (31 operations: 28 staff + 3 public).
- `pnpm catalog:contract:test` — PASS, 47/47.
- pnpm emitted a non-blocking engine warning: repository requests Node 24.19.0; this host ran Node 24.22.1 / pnpm 11.25.0.
- Final post-freeze CI is pending; do not claim merge readiness until the exact candidate checks report SUCCESS. Application code has not changed.
- `node --test docs/contracts/check-R1-006-contract.test.mjs` — PASS, 7/7; includes approved and frozen checksum verification.
- `pnpm format:check` — PASS; `git diff --check` — PASS.
- `pnpm contract:check` / `pnpm contract:test` — PASS / 7/7; frozen R1-002 OpenAPI and generated client remain reproducible.
- `pnpm catalog:contract:check` / `pnpm catalog:contract:test` — PASS / 47/47; frozen R1-004 OpenAPI remains reproducible.
- R1-006 SwaggerParser validation, OpenAPI TypeScript generation and `tsc --noEmit --skipLibCheck` — PASS.
- Exact pre-freeze approved SHA CI run `40068352830` — SUCCESS. Final frozen candidate CI remains required before merge.
- Local toolchain warning only: repository requests Node 24.19.0; this host runs Node 24.22.1 / pnpm 11.25.0.

## SCOPE

R1-006A may change only FROZEN/version/provenance metadata and its checksum manifest after verifying approved content. Do not change R1-002/R1-004, decisions #1–108, R1-006 semantics, production data or Docker environment.

## DECISIONS

- Do not alter FROZEN R1-002/R1-004 or decisions #1–108.
- R1-006A owner approval is recorded for proposal SHA `dab9e7902b3798c21376ce8bb91c965a67c80b2a`; metadata finalization does not alter the approved decisions or semantics.
- R1-006B implementation may begin only after PR #12 is confirmed merged.
- Production migration/deployment and real permission grants are not authorized.

## BLOCKERS

- Exact-candidate GitHub CI and successful PR #12 merge remain required before starting R1-006B.

## NEXT_ACTION

Push the FROZEN 1.0.0 package, mark PR #12 Ready, and merge only after exact-candidate GitHub checks and repository rules pass. Then start R1-006B from updated main on a new branch using a separate Compose project and disposable database.

## DO_NOT_REPEAT

- Do not recreate baseline/task plans or reread unrelated R1-003V creative work.
- Do not edit PR #10, other worktrees, frozen R1-002/R1-004 artifacts, business code or migrations.
