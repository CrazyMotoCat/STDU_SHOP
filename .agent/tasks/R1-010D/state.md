# R1-010D task state

TASK: R1-010D Malware Scanning & Quarantine Processing
STATUS: STAGE_A_FROZEN_PREMERGE_VALIDATION
DELIVERY_MODE: REVIEW_REQUIRED
PHASE: STAGE_A_CONTRACT_FREEZE
UPDATED_AT: 2026-10-28
STAGE_A_BRANCH: codex/r1-010d-contract-proposal
STAGE_A_APPROVAL_SOURCE_HEAD: 1cad9fbb210ded32b07cee3923bec8ab011768a8
STAGE_A_BASE_MAIN_SHA: 2e5b59fc0d99e3580bbdaa6665df335192f83cbe
STAGE_A_LAST_SAFE_BASE: 618deecd4842dc85e89e2dae24d497bae307c6de

## Owner-approved scope

- ADR-005 option B and OD-010D-01…05 approved for isolated Stage B implementation.
- Clarifications A–D are frozen in `docs/contracts/R1-010D-malware-scan-contract.md` version 1.0.0.
- The additive migration backfills exactly existing QUARANTINED sources transactionally and idempotently, copying immutable storage key/hash/size; terminal source rows are excluded.
- Operator retry requires an audit correlation ID and is enabled only for the isolated test profile until a separate production-attribution decision.
- Scanner readiness and loaded engine/signature metadata are attested before and after scanning; any discontinuity or uncertainty fails closed.
- Finalize no-write replay requires the same authorized worker, completed job version, lease-token hash and canonical result fingerprint.
- Existing FROZEN R1-010 1.0.2, other frozen contracts, business decisions 1–108 and public API remain unchanged.
- Stage A does not authorize production migration/deployment, real-document processing, production operator retry, public launch or production permission grants.

## Completed

- Reconciled PR #25 and current `origin/main`; PR #25 is merged at `2e5b59fc0d99e3580bbdaa6665df335192f83cbe`.
- Safely merged the fresh `origin/main` into the PR #26 branch; R1-010C files were integrated by Git and its worktree was not modified.
- Promoted the approved security proposal into a frozen additive contract and accepted ADR-005 option B.
- Added a frozen manifest with approval provenance, source checksums and final contract checksums.
- Added `r1-010d:contract:check` and `r1-010d:contract:test` to local scripts and mandatory CI.

## Verified locally

- `pnpm r1-010d:contract:check`: PASS.
- `pnpm r1-010d:contract:test`: PASS, 6/6.
- `git diff --check`: PASS.
- Node warning: repository expects 24.19.0; local shell provides 24.22.1.
- Full GitHub CI for the updated exact HEAD has not yet run.

## Files changed in Stage A

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

1. Run applicable frozen contract and formatting checks, inspect the exact diff and confirm the original R1-002/R1-004/R1-006A/R1-007/R1-010 contract artifacts remain unchanged.
2. Commit and push the Stage A amendment to existing Draft PR #26; update its description and wait for mandatory exact-HEAD GitHub CI.
3. Mark PR #26 ready and merge only after required checks and repository rules pass; record merge SHA and post-merge CI.
4. Create a separate worktree/branch from the merged main for Stage B and Draft PR. Stage B stops at engineering acceptance; no production operation or merge.

## Stage B gates

- Implement the approved one-table/four-procedure design; no new public route or business permission.
- Run generated-file HTTP/DB runtime tests and real-clamd smoke; mocks alone are insufficient.
- Complete SCAN-01…20, existing R1-010B regression, quality gate, independent backend/database/security/DevOps reviews, exact-HEAD CI and resource measurements.
- No production migration, deployment, real customer documents or production operator retry.

## Do not repeat / protect

- Do not edit or clean the R1-010C worktree, shared project containers or shared Docker volumes.
- Do not report Stage B accepted until the exact CI/reviews/runtime evidence exists.
- Do not invoke production migration, deployment, public launch or real operator retry.
