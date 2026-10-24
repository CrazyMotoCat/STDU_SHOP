# R1-010A — Public RFQ UX & Contract Proposal

- Delivery: `REVIEW_REQUIRED`; no merge, no R1-010B, no live submission.
- Base: `origin/main` / `2e651b02d89b245e596e944aa72ca64f86561a5c`.
- Source scope: REQ-01…04, E2E-01/E2E-17, R1-010; decisions 7, 18, 19, 27, 31–33, 62.
- Allowed writes: new `apps/web` request page/client/CSS and a non-frozen inquiry contract proposal.
- Parallel boundary: R1-007B is isolated in its own worktree; do not touch supplier/backend/schema/RBAC files.
- Acceptance: three editable request flows; local-only file selection and review; accessible responsive UI; no persistence or network submission; production preview gated and `noindex`; proposal and unresolved owner decisions.
- Checks planned: Prettier for changed source, web typecheck, targeted browser review at 1440/375 and keyboard/form/file behavior. No CI, merge, or API integration.
- Status: implementation complete; Draft PR creation pending. No merge.
- Implemented: one responsive `/request-quote` UI for equipment, panels, and engineering; local-only file metadata list; per-flow inputs, contact block, validation, local review; disabled send; server feature flag and `noindex`; proposal and owner decisions.
- Prettier: passed for the new route, client form, CSS module, proposal, and checkpoint.
- Web typecheck: `pnpm --filter @stdu/web typecheck` passed (environment emitted a non-blocking Node engine warning: configured 24.19.0, runtime 24.22.1).
- Browser: 1440/375 scenarios and local interactions passed; keyboard activation and invalid/valid field feedback verified; no page/console errors, horizontal overflow, or non-GET requests; robots metadata is `noindex, nofollow`.
- Screenshots: `C:\Users\mvideo\.codex\visualizations\2026\10\25\r1-010a\` (demo-only contact/file data).
- Backend/API submission and production build were not run or connected; feature remains disabled in production unless `RFQ_PREVIEW_ENABLED=true` is set.
