# R1-010C-PREP checkpoint

**Status:** implemented; Draft PR and owner review pending. **Delivery mode:** REVIEW_REQUIRED.

**Base:** `origin/main` at `81b76b5b084a0ef656c190ca63f9f71f93f092ba` when the isolated worktree was created. The R1-010B implementation is already integrated in that base; its separate worktree and untracked verification artifacts were not modified.

**Contract:** R1-010 OpenAPI is FROZEN at 1.0.2. All 12 artifact hashes match `docs/contracts/R1-010-frozen-manifest.json`. The mapper uses committed `apps/web/src/app/request-quote/inquiry-schema.d.ts`, generated directly from the frozen contract with the repository's `openapi-typescript` tool. This keeps the type dependency inside the web image build context.

**Implemented:** local OD-010-01 contact validation; 1–50 equipment lines and contract-shaped decimal strings; field limits from OpenAPI; pure form-to-`CreateInquiryRequest` mapping for EQUIPMENT, PANELS and ENGINEERING. The mapper preserves user wording and product context as an untrusted hint. No network, upload capability, file bytes, persistence, or submission behavior was added; the send control remains disabled.

**Local verification:** targeted RFQ Vitest, ESLint, web typecheck and production build passed. `rfq:ui:smoke` passed in production mode at desktop and 375 px, including keyboard interaction, contact errors, the 50-line limit, no POST/external requests, no browser storage, and disabled preview behavior. Prettier and diff checks passed. The first hosted workflow failed only in the five-service Docker image build because that context excludes `packages/staff-client`; the mapper now imports the generated declaration inside `apps/web`. Local typecheck/build passed after the fix. Hosted CI must be read from the latest PR HEAD and is not inferred here.

**Remaining:** owner review only for this preparation slice. Real create/upload endpoints, capability lifecycle, and live submission remain outside this task and require separate authorization after backend integration and applicable legal/privacy gates.
