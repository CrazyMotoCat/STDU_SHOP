# Q0-01 integration preparation — current handoff

Date: 2026-11-03 (Asia/Vladivostok). Mode: PR30_PREPARATION / REVIEW_REQUIRED / DRAFT_PR / NO_MERGE.

## Exact integration history

- PR #38 was owner-approved at HEAD `6ecfc530e608b917c85b6dfebc1b0b9867351202`; ordinary merge created main `4c0d2f7310f7040091de38b76ed992449b18b539`.
- Q0-04 INTEGRATED / VERIFIED: [exact-main post-merge CI 41615617436](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41615617436) SUCCESS; all requested local gates passed, 66 Python/FastAPI cases, dedicated import runtime 7/7 zero skipped, sentinel preserved. Q0-03 and VIS-CAT-01 retained. [Post-merge handoff](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38#issuecomment-6600830728).
- PR #30 old HEAD `892b6c1bc40f16d0eb8eb42a9a621415fb0733a3` was clean and matched remote before synchronization.
- History-preserving main merge: `610c3548849bcb4f2a1cf888b505b0a405c9185c`. Five documentation add/add conflicts only; no code/security/contract conflict.
- Reviewed/fixed source commit: `c64c92f6c2c819b77e1b1c7a092d3c6b12cd9337`. A following task-documentation checkpoint changes no source/tests/configuration.
- Only existing PR #30 is updated. No merge of #30, new feature PR, production operation or neighboring worktree edit is authorized.

## Lossless conflict reconciliation

The five root QUALITY files `dependencies.md`, `findings-registry.md`, `remediation-plan.md`, `state.md`, `verification-matrix.md` each preserve BOTH complete source texts: old Q0-01 HEAD and incoming main Q0-03 snapshot, with source commit and Git blob SHA. An explicitly dated current checkpoint precedes historical sections; old NOT_STARTED/freeze/current-main/next-task statements are historical only.

Automated assertions verified both full texts as substrings and all original AUD IDs retained; all AUD-001 through AUD-035 remain. Independent review also checked full-text retention. Q0-03 and Q0-04 current fixed statuses supersede historical pre-fix classifications, without deleting original evidence or implying production incidents. Q0-04's own task directory is unchanged from main.

## Scoped P2 found and fixed during independent review

Frontend review found that a same-body retry receiving a definitive 401/403 cleared stored identity of an earlier response-dropped create. Rejecting the retry does not establish that the original request never committed. After authorization recovery a new key could create a duplicate, especially for valid no-tax suppliers.

Fix in `workspace.tsx`: capture whether this is an existing unresolved retry before dispatch. Preserve its key/hash on every failed retry, while still showing the server denial reason plus uncertainty warning. A definite rejection of a newly created operation may clear its attempt; confirmed success clears, and changed-body replacement still requires explicit confirmation. No backend, session, CSRF or permission logic changes.

RED/GREEN proof uses real Next.js UI, API and disposable PostgreSQL with no-tax suppliers. The real upstream create commits and returns 201 to `route.fetch`, then browser connection is aborted. Next retry is actually rejected by server after session ADMIN_REVOKE (401) or removal of suppliers.write grant (403). Before fix both new cases failed on missing stored key/hash (14 existing cases passed). After fix all 16 supplier runtime tests pass. Login/permission recovery and full reload replay original body/key, navigate to original supplier ID, and assert one Supplier, SupplierRevision, receipt and supplier.created audit. No PII/credentials persisted. Initial 401 fixture used an unsupported synthetic revocation reason, was corrected to existing ADMIN_REVOKE before recording the conclusive RED run; schema was not changed.

Frontend and Security initial PASS/FAIL history is not hidden: initial frontend FAIL/P2 and focused security reassessment supersede initial security PASS. Final source re-reviews close the P2; no remaining P0/P1/P2 in these directions. Backend/PostgreSQL re-review PASS. Independent Integration/regression final outcome and exact final-HEAD confirmation are recorded in final PR evidence; pending reviews/CI must not be inferred from local green tests.

## Executed verification

| Gate | Actual result |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm format:check` | PASS after formatting the added runtime test; initial formatter failure corrected |
| `pnpm typecheck` | PASS |
| `pnpm contract:check` | PASS, frozen equality and client reproducibility |
| `pnpm supplier:contract:check` | PASS, 20 operations, permission/idempotency/receipt parity |
| `pnpm test` | 118 JS passed, 96 environment-gated skips; Python/FastAPI 66 passed, zero skipped |
| `pnpm build` | PASS |
| `pnpm test:r1-007b` | 16 passed, zero skipped; disposable sentinel preserved |
| `pnpm test:r1-006b` after scoped fix | 7 passed, zero skipped; disposable sentinel preserved |
| `git diff --check` | PASS |

The 96 skipped ordinary Vitest cases are reported separately from the enabled dedicated import/supplier runtimes above. Runtime child output is captured with an ignored Node observer; tracked harness implementation is unchanged. Logs are retained in lead-owned `.local/integration-evidence/q001-*`; failed RED/initial formatter output is preserved alongside successful results.

Existing supplier coverage includes response loss after commit and API restart; same-key/body replay; changed body KEY_REUSED rejection; concurrent same-key requests; double click; logout/login/reload; changed-body cancel/explicit confirmation; session-bound CSRF; actor-scoped key/hash-only storage; server RBAC and stale grants; one durable revision/receipt/audit. The added 401/403 recovery cases strengthen unresolved-operation behavior without weakening existing assertions.

## Scope and current delivery gate

Backend source, Prisma/schema/migrations, OpenAPI/DTO/auth/RBAC/security/storage implementation, Python ingestion and import runtime, VIS-CAT UI/smoke files match main exactly. All Q0-03/Q0-04 regressions remain. No automatic product publication, existing-data repair, production migration/deploy or forbidden neighboring task.

Fresh current-HEAD hosted CI must succeed and all four independent directions must PASS before READY_FOR_OWNER_MERGE_DECISION. The final PR verification evidence records final SHA/run/reviews without repeatedly changing the verified HEAD. Historical CI on 892b6c1 is not current evidence. Keep PR #30 Draft and unmerged; stop for a separate owner decision after final handoff.

Nonblocking warnings: local pnpm engine mismatch (Node 24.22.1 versus pinned 24.19.0), existing Starlette/httpx and pg concurrent-query deprecations. Tests passed. No global Docker/worktree cleanup was performed.
