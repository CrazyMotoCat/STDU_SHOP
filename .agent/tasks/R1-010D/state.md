# R1-010D task state

TASK: R1-010D Malware Scanning & Quarantine Processing
STATUS: L0_INTEGRATED; STAGE_B_NOT_ACCEPTED
DELIVERY_MODE: REVIEW_REQUIRED
PHASE: L0_POLICY_INTEGRATED
UPDATED_AT: 2026-11-02
STAGE_A_BRANCH: codex/r1-010d-contract-proposal
STAGE_A_APPROVAL_SOURCE_HEAD: 1cad9fbb210ded32b07cee3923bec8ab011768a8
STAGE_A_BASE_MAIN_SHA: 2e5b59fc0d99e3580bbdaa6665df335192f83cbe
STAGE_A_LAST_SAFE_BASE: 618deecd4842dc85e89e2dae24d497bae307c6de
L0_CONTRACT_PR: #34, merged into implementation PR #33 branch
L0_IMPLEMENTATION_PR: #33, merged to main by ordinary merge commit
L0_APPROVED_IMPLEMENTATION_HEAD: fcf3f6d5a02f080f5822d4fbd1a5ed9173b07710
L0_MAIN_MERGE_SHA: e9af3a7dbe0eee29bb3cacceb3d608662502b0b3
L0_EXACT_HEAD_CI: 41446534457 SUCCESS
L0_POST_MERGE_CI: 41450647400 SUCCESS

## Owner-approved scope

- ADR-005 option B and OD-010D-01…05 approved for isolated Stage B implementation.
- Clarifications A–D are frozen in `docs/contracts/R1-010D-malware-scan-contract.md` version 1.0.0.
- The additive migration backfills exactly existing QUARANTINED sources transactionally and idempotently, copying immutable storage key/hash/size; terminal source rows are excluded.
- Operator retry requires an audit correlation ID and is enabled only for the isolated test profile until a separate production-attribution decision.
- Scanner readiness and loaded engine/signature metadata are attested before and after scanning; any discontinuity or uncertainty fails closed.
- Finalize no-write replay requires the same authorized worker, completed job version, lease-token hash and canonical result fingerprint.
- Existing FROZEN R1-010 1.0.3 and R1-010D 1.0.1, other frozen contracts, business decisions 1–108 and public API remain unchanged except for their explicitly approved L0/versioned amendments.
- Stage A does not authorize production migration/deployment, real-document processing, production operator retry, public launch or production permission grants.

## Completed

- Reconciled PR #25 and current `origin/main`; PR #25 is merged at `2e5b59fc0d99e3580bbdaa6665df335192f83cbe`.
- Safely merged the fresh `origin/main` into the PR #26 branch; R1-010C files were integrated by Git and its worktree was not modified.
- Promoted the approved security proposal into a frozen additive contract and accepted ADR-005 option B.
- Added a frozen manifest with approval provenance, source checksums and final contract checksums.
- Added `r1-010d:contract:check` and `r1-010d:contract:test` to local scripts and mandatory CI.
- Integrated approved L0 default-deny implementation and R1-010/R1-010D contract alignment: all staff downloads of Inquiry originals deny before storage access until exact-original eligibility is separately approved and implemented; CLEAN alone grants no access.
- Merged PR #33 to `main` as `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`, preserving the approved implementation HEAD as second parent. PR #34 was merged into the PR #33 branch first.
- Updated and synchronized a clean local `main` worktree to `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`.
- The PR exact-head and post-merge GitHub Actions runs both succeeded: #41446534457 and #41450647400. The post-merge workflow completed all 38 steps successfully.
- FROZEN R1-010 1.0.3 and R1-010D 1.0.1 checkers and Inquiry OpenAPI validation pass on the new `main`.
- PR #28 remains Draft. Its current branch still contains the pre-L0 positive CLEAN download path and must be synchronized and re-tested before any separate owner decision.

## Verified locally

- On the approved implementation HEAD, R1-010 frozen checker and tests: PASS, 33/33; R1-010D checker and tests: PASS, 7/7.
- Inquiry OpenAPI validation, generation and parity, TypeScript client reproducibility: PASS.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `git diff --check`: PASS. Unit results were 114 Vitest passed / 88 skipped (optional infrastructure) and 15 pytest passed.
- `pnpm test:r1-010b`: PASS, 34/34; `pnpm test:r1-010c:e2e`: PASS, 13/13 in the isolated project.
- Hosted exact-head CI #41446534457 and post-merge CI #41450647400: SUCCESS; the latter completed 38/38 steps.
- Frozen R1-010/R1-010D checkers and Inquiry OpenAPI validation were also rerun on `main` at `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`: PASS.
- Local Node is 24.22.1 while the repository pins 24.19.0; hosted CI used the pinned toolchain.

## Files from the initial Stage A contract

- `docs/adr/ADR-005-malware-scanning.md`
- `docs/contracts/R1-010D-malware-scan-contract.md`
- `docs/contracts/R1-010D-frozen-manifest.json`
- `docs/contracts/check-R1-010D.mjs`
- `docs/contracts/check-R1-010D.test.mjs`
- `docs/spec/09_ROADMAP_BACKLOG.md`
- `package.json`
- `.github/workflows/ci.yml`
- `.agent/tasks/R1-010D/state.md`

## Next

1. Keep PR #28 Draft until it is synchronized with current `main` and fresh R1-010B, R1-010D, R1-010C, and L0 no-positive-download checks pass.
2. Obtain a separate owner decision before integrating PR #28 or enabling any positive CLEAN eligibility profile.
3. Do not begin R1-011 or perform production inventory, migration, deployment, external download-gate changes, real-document processing, or CLEAN enablement under this checkpoint.

## Stage B gates

- Implement the approved one-table/four-procedure design; no new public route or business permission.
- Run generated-file HTTP/DB runtime tests and real-clamd smoke; mocks alone are insufficient.
- Complete SCAN-01…20, existing R1-010B regression, quality gate, independent backend/database/security/DevOps reviews, exact-HEAD CI and resource measurements.
- No production migration, deployment, real customer documents or production operator retry.

## Do not repeat / protect

- Do not edit or clean the R1-010C worktree, shared project containers or shared Docker volumes.
- Do not report Stage B accepted until the exact CI/reviews/runtime evidence exists.
- Do not invoke production migration, deployment, public launch or real operator retry.
