# Q0-04 dependencies and frozen boundaries

## Base and ownership

- Dedicated branch `codex/quality-q0-04-csv-boolean-sku`, initially created from freshly fetched `origin/main` `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`, then rebased onto fresh `origin/main` `74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d`. Intervening changes affected inquiry download/security and R1-010D task state only; none overlap Q0-04 implementation paths. Required local checks were rerun after synchronization.
- Q0-03 PR #35 remains a separate Draft PR. No Q0-03 commit is cherry-picked into this branch; a temporary detached worktree at its published head plus the Q0-04 commit passed 66 Python tests and the disposable R1-006B runtime.
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
