# R1-004A

TASK: R1-004A
STATUS: PROPOSED_CONTRACT_REVIEWABLE
DELIVERY_MODE: REVIEW_REQUIRED
CHECKPOINT_STATUS: SAFE
PHASE: proposed contract pushed; awaiting owner review of exact PR HEAD
UPDATED_AT: 2026-10-23
BRANCH: codex/r1-004a-catalog-contract
BASELINE_MAIN: 28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e
LAST_SAFE_COMMIT: 28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e

## Frozen inputs and owner selections

- Owner task: `R1-004A: Catalog Domain Contract Freeze` from the provided attachment.
- Normative scope: CAT-02..CAT-06, SRC-03..SRC-05, SRC-07; decisions #1, #2, #6, #24..#26, #32..#34, #49, #55..#58, #60; ADR-001/003/004; FROZEN R1-002 1.0.0.
- Baseline was clean and synchronized with freshly fetched `origin/main` at `28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e`.
- Owner selected OD-004A-10 paginated direct ACTIVE children: keyset cursor, `pageSize` <= 100, no recursive payload, total count, or page-number ceiling.
- Owner selected category archival checks based on active children and non-archived products' current draft/pending/published pointers; non-current returned/rejected/superseded history does not block.
- Owner selected OD-004A-11 staff list semantics: DRAFT/PENDING_REVIEW/PUBLISHED use corresponding current pointers; `categoryId` applies to the same pointer, or any current pointer without state; ARCHIVED uses root state, while ARCHIVED + categoryId is rejected because archive clears pointers.
- Product archive semantics are explicit in prose, JSON model, OpenAPI, checker and CATB-21: atomically withdraw pending as WITHDRAWN, clear all three root pointers, set ARCHIVED/revoke public visibility, audit, and preserve revision/FileVersion history.
- Contract remains PROPOSED / REVIEW_REQUIRED. No implementation, migration, production operation, merge, or R1-002B work is authorized before owner approval of the updated contract SHA.

## Hard boundaries

- Do not edit decisions #1–108, frozen R1-002 1.0.0 artifacts, Prisma schema/migrations, runtime API/auth/RBAC, seed assignments, or production configuration.
- Do not add Supplier, SupplierOffer, IngestionRun, ImportJob, PricingRule, upload/download, or public file delivery.
- No automatic functional analogues, publishing, or bulk approval.
- Public data contains no unpublished revision, cost, supplier, source provenance, internal comments, FileVersion identifiers/storage keys, or unverified files. Until an approved price source exists, expose `Цена по запросу`.

## Contract corrections

- Propagated `CATEGORY_INACTIVE_PARENT` through API and audit.
- Bounded public category navigation with direct-child keyset pagination and matching index order.
- Aligned category archive usage with current pointers and historical revision retention.
- Added atomic product root/revision identity synchronization and post-submit freeze rule.
- Fixed generated OpenAPI to preserve staff collection pagination/filter parameters and documented current-pointer state/category filters.
- Rejected `ARCHIVED + categoryId` as `VALIDATION_ERROR`; clarified archive clearing/pending-withdrawal behavior consistently in JSON model and OpenAPI.
- Added CATB-37/38 and checker regression coverage; contract suite has 33 tests.

## Independent reviews

- Backend: final read-only PASS; no remaining API/model consistency finding after archive transition was mirrored in JSON/OpenAPI.
- Database: final read-only PASS; pointer/archive invariant and category `sortOrder` DB/API/cursor constraints align.
- Security: final read-only PASS; staff access boundaries, public category pagination and cursor constraints remain sound.
- Runtime scenarios CATB-21/35/37/38 are requirements for R1-004B; they were not implemented/executed as catalog runtime behavior in this contract-only task.

## Verification actually run

- `pnpm toolchain:check`, `pnpm db:validate`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build` — PASS. Toolchain wrapper reported pinned Node 24.19.0; direct `pnpm` reports installed Node 24.22.1 engine warning.
- `pnpm catalog:contract:generate`, `pnpm catalog:contract:check` — PASS; generated OpenAPI is reproducible and model/RBAC/API/audit/decision/test-matrix checker passes.
- `pnpm catalog:contract:test` — PASS, 33/33.
- Frozen R1-002 checks: `pnpm contract:check`, `pnpm contract:test` 7/7, `node docs/contracts/check-R1-002.mjs`, `node --test docs/contracts/check-R1-002.test.mjs` 30/30 — PASS.
- `pnpm test`: 39 Vitest passed, 27 skipped (66 total); ingestion pytest 5 passed, one dependency deprecation warning.
- `pnpm test:r1-002b` — PASS: fresh/populated migration checks, 27/27 runtime tests, post-runtime sentinel unchanged.
- `pnpm ui:smoke` — PASS; on Windows the bounded shutdown forced only its owned web process after grace expiry and verified cleanup.
- `pnpm smoke` first attempt failed because this project's Compose held host port 3000. Stopped only `stdu-shop-r1-001` services without deleting volumes, reran — PASS; dependencies restored by the smoke and volumes preserved.
- `pnpm smoke:host` — three consecutive Windows runs PASS; each shutdown used bounded force on the task-owned web/API/ingestion processes after grace expiry; smoke verified cleanup and preserved volumes.
- Restored the main project Compose; all five services reported healthy. No project volumes were deleted.
- The current proposal is published in Draft PR #7. CI status is checked live against its exact HEAD before owner handoff; do not merge or start R1-004B before owner approval.

## Next action

Hand off Draft PR #7 for owner review of the exact proposed contract HEAD and OD-004A-01…11. Keep contract status PROPOSED / REVIEW_REQUIRED; do not merge or start R1-004B before owner approval.
