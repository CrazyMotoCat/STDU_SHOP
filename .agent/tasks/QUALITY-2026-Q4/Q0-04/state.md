# Q0-04 task state

## Status

- Task ID: `Q0-04` — AUD-010, AUD-021, AUD-024.
- Delivery: `REVIEW_REQUIRED / DRAFT_PR / NO_MERGE`.
- Branch: `codex/quality-q0-04-csv-boolean-sku`.
- Initial safe commit: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`.
- Current implementation commit: `76c290dba3186e0b1f5e1b1f9eb70fee82ededf7`; verification checkpoint commit: `31e42d5ac2d6d3d2875f70588c4a3cc4f3cc24da`.
- Current base: `origin/main` `74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d` (fresh fetch 2026-11-02); local checks were rerun after sync. Intervening base commits affect inquiry download/security and R1-010D task state only; no Q0-04 implementation paths overlap.
- Draft PR: [#38](https://github.com/CrazyMotoCat/STDU_SHOP/pull/38), base `main`; created at head `3df493c2cc20068a0df433a018c37ecca94cecc9`. The first hosted run was `41454494983`; its exact-head status must be refreshed after this documentation checkpoint is pushed.

## Verified on the synchronized implementation commit

- Python parser/FastAPI: 30 passed; one existing Starlette/httpx deprecation warning, including the 25-record sample-boundary regression.
- Python mypy and Ruff: pass.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm contract:check`, `pnpm build`: pass.
- `pnpm exec vitest run`: 114 passed, 90 skipped.
- `pnpm test:r1-006b`: pass; isolated disposable database sentinel preserved; CSV/XLSX preview assertions include no new product revision, no import decision, and no product-revision audit event.
- `git diff --check`: pass.
- Independent review: Python/Data Parsing PASS; Nest/Data Integrity PASS; PostgreSQL/transactions PASS; Security PASS. No unresolved P0/P1/P2 findings.

## Next action

Q0-03 compatibility passed in a temporary combined worktree: 66 Python tests and `pnpm test:r1-006b` passed with Python imports directed to the combined source tree. Push this documentation checkpoint, then verify all required hosted checks on the exact resulting PR head. Keep PR #38 Draft and do not merge.

The temporary worktree is no longer registered, but its directory remains because Git cleanup hit Windows `Filename too long` and automatic command review rejected manual junction removal.

## Do not repeat unless implementation changes

The completed local gates, four read-only reviews, and Q0-03 compatibility check above. Hosted CI remains outstanding.
