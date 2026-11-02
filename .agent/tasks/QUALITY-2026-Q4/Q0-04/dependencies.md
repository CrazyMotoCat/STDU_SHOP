# Q0-04 dependencies and frozen boundaries

## Base and ownership

- Dedicated branch `codex/quality-q0-04-csv-boolean-sku`, created from freshly fetched `origin/main` `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. A later fresh fetch found `origin/main` at `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`; the seven intervening commits affect inquiry download/security paths and do not overlap Q0-04 implementation files. Rebase onto this current base before publication and rerun checks.
- Q0-03 PR #35 remains a separate Draft PR. No Q0-03 commit is cherry-picked into this branch; compatibility is checked independently against its published head after its exact-head CI passed.
- Agent 2 owns the independent public catalog / Product Media work; do not edit its worktrees or files.

## Frozen contracts and behavior

- Existing CSV encodings remain UTF-8 and Windows-1251. Explicit delimiter values remain comma, semicolon, and TAB; the current controlled `ENCODING_REQUIRED` behavior is used when inference is ambiguous.
- Existing internal NDJSON v1 cell shape and enum remain unchanged (`TEXT`, `NUMBER`, `BOOLEAN`, `FORMULA`, `BLANK`); `numberFormat` is already an optional field.
- No schema, migration, OpenAPI, DTO, authentication, or permission changes. NestJS remains responsible for business state and preview transactions; Python remains staged parsing only.
- SKU identity remains the existing exact tuple: brand + manufacturer name + original part number + modification, with current NFC and edge-space semantics. No case folding, SKU grammar invention, silent fix-up, or existing-catalog rewrite.
- Catalog import remains private and manually reviewed. Preview does not publish products or create a product revision/decision.

## Neighboring work and safety

- Do not touch Q0-01 PR #30 or Q0-03 PR #35 files/worktrees, R1-010D/CLEAN, or the public catalog / Product Media worktrees.
- Runtime proof uses the existing R1-006B disposable PostgreSQL harness; no production database or named production volume. The final runtime review confirms the isolated project and both CSV/XLSX preview no-revision/no-decision/no-revision-audit assertions pass.
- Delivery stays `REVIEW_REQUIRED / DRAFT_PR / NO_MERGE`; unresolved P0/P1/P2 review findings block completion.
