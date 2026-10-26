# R1 task state

TASK: R1-010B-01 Public Inquiry Contract
STATUS: REVIEW_REQUIRED
CHECKPOINT_STATUS: SAFE
PHASE: Final owner review corrections; stop for owner approval after CI
UPDATED_AT: 2026-10-26T22:27:26+10:00
BRANCH: codex/r1-010b-01-inquiry-contract
LAST_SAFE_COMMIT: 97b4ec3b4b0cbe146f7e77eeb7f2f7ed14799038
CURRENT_WORKTREE_STATE: DIRTY_EXPECTED — this correction package only

## COMPLETED
- Original R1-010B-01 contract preparation is on existing Draft PR #20; this correction pass resumed from PR HEAD `97b4ec3b4b0cbe146f7e77eeb7f2f7ed14799038`.
- Owner requested OD-010-03/04 corrections, an R1-010A compatibility matrix and no change to PR #18, frozen contracts, migrations, production DB, Docker or implementation scope.
- OD-010-04 now proposes one terminal CLOSED state with a strict typed early-close branch for five reasons and five eligible pre-quote states; quote lifecycle still exclusively controls QUOTE_SENT closure.
- OD-010-03 now proposes server-selected MVP_SAFE and ENGINEERING_DOCUMENTS profiles, keeps PDF/CSV/XLSX only, states shared-NAT tradeoffs and bounded streaming/StoragePort/scanner conditions, and rejects DOCX/DWG/DXF/archives pending separate review.
- PR #18 was read-only reviewed at snapshot HEAD `c21a14e1385363496714cae76910ecf9f28c7470`. The compatibility matrix states that the form remains preview-only; it does not claim API integration.
- DTO corrections preserve optional contact context, free-text desired deadline and customer comment; panel task and engineering subject are the only required kind-specific text fields. OD-010-01 still requires contact name and email or phone, so future UI integration must add those validations.
- Acceptance matrix now has REQB-01…41, including a separate closure case for each required reason. Contract checker and regression suite now enforce the closure variants, profile bounds and preview compatibility constraints.

## VERIFIED
- `node docs/contracts/check-R1-010.mjs` — PASS; six new tables, 15 operations (4 public/11 staff), nine permissions, REQB-01…41.
- `node --test docs/contracts/check-R1-010.test.mjs` — PASS, 23/23.
- `node scripts/validate-openapi.mjs docs/contracts/R1-010-inquiries.openapi.json` — PASS.
- `openapi-typescript` generation and same-file `--check` — PASS; temporary generated declaration removed.
- Targeted Prettier check — PASS; `git diff --check` — PASS.
- Focused architecture/security consistency review — PASS with the contact validation and actual scanner/StoragePort integration gates explicitly documented.
- Earlier GitHub Actions run `40316410894` passed for prior HEAD `aa1ab91cf08179266bd3e1c0342f396bc723f45a`; it does not verify this correction diff.

## CURRENT PACKAGE
- Expected changes: R1-010 OpenAPI/model/state-machine/audit/attachment/profile/test matrix; R1-010 contract checker/tests; owner decisions, review report, implementation plan and this checkpoint.
- No application code, migration, FROZEN R1-002/R1-004/R1-006/R1-007, RBAC grants, production data, Docker or PR #18 path changed.
- Existing Draft PR #20 remains the delivery target; this package is not yet pushed and exact-HEAD GitHub CI is pending.

## PENDING
- Inspect final staged diff, commit and push the consolidated correction package to PR #20.
- Verify mandatory GitHub Actions for the new exact HEAD; do not treat the earlier CI as proof.
- Present final SHA and approval wording for OD-010-01…05; stop at Owner Approval. Do not merge or start R1-010B.

## DO_NOT_REPEAT
- Do not recreate the worktree/branch or redo the original contract preparation.
- Do not edit PR #18 or any frozen contract.
- Do not start migration, API/UI implementation, production collection, permission grants, deployment, merge or R1-011 parsing.
