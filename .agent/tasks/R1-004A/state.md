# R1-004A

TASK: R1-004A
STATUS: COMPLETE
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: FROZEN 1.0.0 merged; exact main post-integration CI passed
UPDATED_AT: 2026-10-24
BRANCH: main
BASELINE_MAIN: 28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e
LAST_SAFE_COMMIT: 24c9653780c7e8dc511dd5acf1706ecdb9e191eb
APPROVED_SOURCE_SHA: 8ae4dd8cfd15e3722d97259818b238924851c963
CONTRACT_VERSION: FROZEN 1.0.0
FROZEN_HEAD: 0a749af35e422f55be050bd256ea1e8639193541
MERGED_MAIN_SHA: 24c9653780c7e8dc511dd5acf1706ecdb9e191eb
PULL_REQUEST: https://github.com/CrazyMotoCat/STDU_SHOP/pull/7
POST_INTEGRATION_CI: https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39970886845
COMPLETION_RECORD_MODE: DIRECT_MAIN (checkpoint documentation only)

## Frozen inputs and owner selections

- Owner task: `R1-004A: Catalog Domain Contract Freeze` from the provided attachment.
- Normative scope: CAT-02..CAT-06, SRC-03..SRC-05, SRC-07; decisions #1, #2, #6, #24..#26, #32..#34, #49, #55..#58, #60; ADR-001/003/004; FROZEN R1-002 1.0.0.
- Baseline was clean and synchronized with freshly fetched `origin/main` at `28d9a85aa82dc4bf3c116e16ca6a3973a9d7bc6e`.
- Owner selected OD-004A-10 paginated direct ACTIVE children: keyset cursor, `pageSize` <= 100, no recursive payload, total count, or page-number ceiling.
- Owner selected category archival checks based on active children and non-archived products' current draft/pending/published pointers; non-current returned/rejected/superseded history does not block.
- Owner selected OD-004A-11 staff list semantics: DRAFT/PENDING_REVIEW/PUBLISHED use corresponding current pointers; `categoryId` applies to the same pointer, or any current pointer without state; ARCHIVED uses root state, while ARCHIVED + categoryId is rejected because archive clears pointers.
- Product archive semantics are explicit in prose, JSON model, OpenAPI, checker and CATB-21: atomically withdraw pending as WITHDRAWN, clear all three root pointers, set ARCHIVED/revoke public visibility, audit, and preserve revision/FileVersion history.
- Owner final correction to OD-004A-06: at least one technical filter requires categorySlug and explicitly includeDescendants=false; true or omission (default true) returns 400 VALIDATION_ERROR before a database query. Only the exact category's own AttributeDefinition applies, without inheritance or automatic code matching across categories; descendant search without technical filters remains allowed.
- Catalog OpenAPI contains 31 operations: 28 staff and 3 public. The former report/PR claim of 23 operations was incorrect; the route set is unchanged. Frozen R1-002 separately retains its valid 23-operation count.
- Owner explicitly approved the complete 0.1.0-proposed package and OD-004A-01…11 on 2026-10-24 (Asia/Vladivostok) at exact source SHA 8ae4dd8cfd15e3722d97259818b238924851c963 and authorized metadata-only FROZEN 1.0.0, Ready for Review and AUTO_MERGE after GitHub gates.
- R1-004B may start after successful integration and post-integration CI. Autonomous implementation requires independent backend/security/database review and actual PostgreSQL/HTTP/runtime CATB-01…38 evidence. The initial catalog-permission command may be implemented/tested only on an isolated test database; actual operator execution on the working database, real permission grants, production migrations/deployment and destructive operations are not authorized.

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
- Added CATB-37/38 and checker regression coverage in the prior proposal.
- Synchronized OD-004A-06, public search parameter descriptions/invariants and machine-readable technical-filter policy with CATB-25. Added nine negative checker tests; the contract suite now has 42 tests.

## Independent reviews

- Freeze audit: fresh independent READ_ONLY PASS against approved 8ae4dd8c; all normative JSON/OD/CATB content unchanged after removing allowed metadata. Checker and 44/44 contract tests independently rerun PASS.
- Backend: repeated read-only PASS for final OD-004A-06 corrections; independently ran checker and 42/42 tests and verified unchanged 31 operations/components/other OD sections.
- Database: prior proposal read-only PASS; no models, schemas or database rules changed in this final correction iteration.
- Security: repeated read-only PASS for final OD-004A-06 corrections; independently ran checker and 42/42 tests and verified category-local filter scope, default-true rejection and unchanged permissions/publication boundaries.
- Runtime scenarios CATB-21/35/37/38 are requirements for R1-004B; they were not implemented/executed as catalog runtime behavior in this contract-only task.

## Verification actually run

### Owner-approved freeze — 2026-10-24

- Exact approved-source comparison: PASS for all model/RBAC/audit/OpenAPI semantic content, OD-004A-01…11 and CATB-01…38; FROZEN R1-002 and specification files unchanged.
- `pnpm catalog:contract:generate`, `pnpm catalog:contract:check` — PASS; FROZEN 1.0.0 metadata/provenance, 31 operations and reproducible validated OpenAPI.
- `pnpm catalog:contract:test` — PASS, 44/44; adds negative tests for thawed status/version and missing/changed owner-approval provenance.
- `pnpm lint`, `pnpm format:check`, `git diff --check` — PASS.
- PR #7 moved to Ready for Review and merged using normal merge API with expected freeze HEAD; no GitHub rule bypass, unresolved review thread or blocking finding.
- Exact freeze HEAD 0a749af3: full CI run #30 (39969830349) PASS, first attempt; actual tested merge candidate adf3009b64509d865ee1b0624fb4afb72ac7d9da verified.
- Merge/main 24c96537: full push CI run #31 (39970886845) PASS, first attempt; main tree equals verified freeze HEAD. All quality/contract/baseline runtime/UI/Compose and three host smoke steps passed.

### Final corrections before owner approval — 2026-10-24

- `pnpm catalog:contract:generate`, `pnpm catalog:contract:check` — PASS; generated OpenAPI is reproducible and validates successfully, including 31 operations (28 staff, 3 public).
- `pnpm catalog:contract:test` — PASS, 42/42, including nine new negative contract checks. These validate the proposed artifacts/checker, not an implemented catalog HTTP runtime.
- `pnpm lint`, `pnpm format:check`, `git diff --check` — PASS.
- Independent scope comparison against b9b90104: operation routes/IDs, OpenAPI components, models, RBAC, audit registry and OD sections outside OD-004A-06 are unchanged.
- Proposal review and exact HEAD CI were completed in PR #7 before the owner approval recorded above; the frozen package is now merged with successful post-integration CI.

### Historical proposal verification — before final corrections

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

## Next action

Start R1-004B step 1 on its own feature branch: record frozen artifact hashes and the R1-002 schema/migration baseline, then proceed through the approved implementation plan and mandatory independent/runtime gates. Catalog runtime CATB-01…38 are not yet executed.
