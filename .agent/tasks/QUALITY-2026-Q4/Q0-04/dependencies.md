# Q0-04 dependencies and frozen boundaries

## Current integration base

- Branch `codex/quality-q0-04-csv-boolean-sku`; PR #38 remains Draft, preparation only, no merge authorization.
- Owner-authorized PR #35 merged as main `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`; exact post-merge CI 41466967787 SUCCESS, Q0-03 INTEGRATED / VERIFIED.
- After that success, a normal merge of main into Q0-04 created `a27af9cc459d8ee14e1daac17fe12678c4166566` from old HEAD `de32d16e64e687e044e0313fcbe01d938949b78b`. No conflicts or force push; entire tree equals earlier combined proof 2abfdecb.
- Both packages' regressions reran successfully on this synchronized branch; current exact-head CI outcome is recorded externally in PR checks and final verification comment.

## Frozen contracts and behavior

- CSV encodings remain UTF-8 and Windows-1251. Explicit delimiters remain comma, semicolon and TAB. Ambiguous inference uses existing controlled ENCODING_REQUIRED behavior.
- NDJSON v1 shape and enums unchanged: TEXT, NUMBER, BOOLEAN, FORMULA, BLANK; optional numberFormat unchanged.
- No schema/migration/OpenAPI/DTO/auth/permission changes. NestJS owns business state, authorization and transactions; Python returns staged parsing records only.
- Exact SKU tuple remains brand + manufacturer name + original part number + modification, with existing NFC/edge-space semantics. No case folding, silent SKU fix-up or catalog rewrite.
- Import remains private, manually approved per row. Preview does not publish products or create ProductRevision/ImportDecision.
- Q0-03 strict XLSX relationships, coordinates, style/shared-string bounds, supported types and pre-NDJSON late rejection are preserved unchanged.

## Neighbor safety

Disposable R1-006B PostgreSQL only, no production or named shared volumes. No changes to PR #30, R1-010D, VIS-CAT, Q0-02/Q0-05 or other agents' worktrees. Owner must separately decide any merge of PR #38.

## Latest base after parallel upstream integration

Current main is `a2a19c9fe07b7afac6dfc46996c1294ea3111b6a` (separate PR #32, three catalog UI/smoke paths, no import overlap). Second normal main merge `f52b2689b288326970951fd04d699fd1addde0d4` retains Q0-03/Q0-04 unchanged and introduces no conflicts. Local quality/build/contract/regression/runtime gates were repeated and passed. Prior green CI 41469119154 applies to old 6c406ee; require fresh CI for the resulting final HEAD. No VIS-CAT edits or other-agent worktree changes were performed by this task; upstream content was integrated through main history only.
