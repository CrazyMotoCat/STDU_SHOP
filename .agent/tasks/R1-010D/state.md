# R1-010D task state

TASK: R1-010D Malware Scanning & Quarantine Processing — Stage A
STATUS: READY_FOR_OWNER_APPROVAL
DELIVERY_MODE: REVIEW_REQUIRED
CHECKPOINT_STATUS: DIRTY_EXPECTED / REVIEWABLE_PROPOSAL
PHASE: STAGE_A_CONTRACT_PROPOSAL
UPDATED_AT: 2026-10-27
BRANCH: codex/r1-010d-contract-proposal
BASE_MAIN_SHA: 81b76b5b084a0ef656c190ca63f9f71f93f092ba
LAST_SAFE_COMMIT: 81b76b5b084a0ef656c190ca63f9f71f93f092ba

## COMPLETED

- Inspected the real R1-010B model, migration guards/grants, StoragePort/private quarantine reader, staff download boundary, audit registry, Compose files and acceptance matrix.
- Compared topology A (backend worker + clamd) and B (dedicated NestJS scanner-worker + clamd). The proposal recommends B with no worker file mount, a private lease-bound API content stream and distinct database privileges.
- Prepared ADR-005, the proposed R1-010 amendment, resource assessment, retry/lease/audit model, and SCAN-01…20 matrix.
- Updated the isolated proposal worktree only; the parallel R1-010C-PREP worktree was not touched.

## VERIFIED

- Base checkout was clean, freshly fetched origin/main matched 81b76b5b084a0ef656c190ca63f9f71f93f092ba, and the proposal branch is based on that commit.
- `pnpm contract:check`: PASS; frozen OpenAPI equality (23 staff operations, 15 Inquiry operations) and generated client reproducibility passed.
- `pnpm contract:test`: PASS, 10/10.
- `pnpm inquiry:contract:check`: PASS; 15-operation frozen Amendment 01 validation passed.
- `pnpm exec prettier --check docs/adr/ADR-005-malware-scanning.md docs/proposals/R1-010D-malware-scanning-contract.md docs/spec/09_ROADMAP_BACKLOG.md .agent/tasks/R1-010D/state.md`: PASS.
- `git diff --check`: PASS.
- Official ClamAV docs rechecked 2026-10-27: 1.4.6 is latest 1.4 LTS patch; official image is `clamav/clamav`; 3 GiB+ RAM, 1 CPU and 5 GiB free are recommended; INSTREAM framing and socket restrictions confirmed.
- Node emits a non-blocking engine warning: repository expects 24.19.0; shell reports 24.22.1. The checks completed successfully.
- Application/runtime tests, fake scanner adapter tests and real clamd smoke: NOT RUN; Stage A has no implementation or approved DB contract.
- GitHub CI: NOT RUN yet; pending Draft PR creation and required checks on its exact HEAD.

## UNCOMMITTED

- Expected task-owned files only: ADR-005, R1-010D proposal, R1-010D state checkpoint and one proposed backlog line.

## DECISIONS

- FROZEN R1-002/R1-004/R1-006A/R1-007/R1-010 and decisions 1–108 remain untouched.
- No Owner Approval yet; ADR-005 and OD-010D-01…05 remain PROPOSED.
- Proposed B adds one InquirySourceDocumentScanJob table, four narrow stored procedures, separate API/worker/operator procedure grants, a private non-published content stream and one job-control audit action; no new business RBAC permission or public API.
- No authorization for production migration, deployment, live scanning, production data processing or real permissions changes.

## OPEN RISKS / APPROVAL GATES

- Owner must approve or amend OD-010D-01…05 before Stage B implementation.
- Before any CLEAN verdict, reproduce nested XLSX/OLE2 behavior and prove limit handling against the exact pinned engine/image and signatures; upstream user reports are not confirmed vendor advisories.
- Current VDS RAM/CPU/disk and signature-update access are unmeasured; no production readiness is asserted.
- Operator retry audit identifies a controlled service/operator label, not an individual StaffUser. This limitation is explicit in OD-010D-02.

## FILES_CHANGED

- `docs/adr/ADR-005-malware-scanning.md`: proposed A/B review and recommended B architecture.
- `docs/proposals/R1-010D-malware-scanning-contract.md`: proposed schema/security/worker contract, resource assessment and SCAN-01…20.
- `docs/spec/09_ROADMAP_BACKLOG.md`: records the contract-first subtask as proposed.
- `.agent/tasks/R1-010D/state.md`: checkpoint.

## NEXT_ACTION

Review only the task-owned staged diff, commit and push the proposal branch, create the Draft PR titled `R1-010D-01 — Malware Scanner Architecture & Security Contract`, verify required checks for its exact HEAD, attach the PR and stop for Owner Approval.

## DO_NOT_REPEAT

- Do not re-inspect or modify the parallel R1-010C-PREP worktree.
- Do not implement scanner code, migration, job table, audit registry changes, or Compose changes before Owner Approval.
- Do not claim fake scanner tests, real clamd smoke, runtime verification, or production capacity measurement was run.
- Do not merge the Draft PR or begin Stage B before approval.
