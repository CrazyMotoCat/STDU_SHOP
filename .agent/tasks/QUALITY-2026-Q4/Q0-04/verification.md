# Q0-04 verification matrix

Initial investigation base: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. The branch is synchronized on `origin/main` `74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d`; the seven earlier commits touched inquiry-download/security files and the latest commit touched only `.agent/tasks/R1-010D/state.md`. No Q0-04 implementation paths overlap. Local gates below were rerun after this synchronization on branch HEAD `31e42d5ac2d6d3d2875f70588c4a3cc4f3cc24da`.

| Gate | Evidence | Result |
|---|---|---|
| Python parser + FastAPI | `.venv\Scripts\python.exe -m pytest tests -q` | PASS — 30 passed; one existing Starlette/httpx deprecation warning. Includes a direct 25-record sample-boundary regression. |
| Python static checks | `.venv\Scripts\python.exe -m mypy src`; `.venv\Scripts\python.exe -m ruff check src tests` | PASS — no issues |
| Nest/API | Upload inference, explicit override, typed Boolean cells, numeric/text SKU preservation, preview identity and audit checks via `pnpm test:r1-006b` | PASS — disposable harness exit 0; database sentinel preserved |
| Full Vitest | `pnpm exec vitest run` | PASS — 114 passed, 90 skipped across 20 files |
| Lint / format / typecheck | `pnpm lint`; `pnpm format:check`; `pnpm typecheck` | PASS — Node engine warning only (installed 24.22.1; repository pins 24.19.0) |
| Build | `pnpm build` | PASS — API, staff client, web, ingestion package built |
| Frozen contracts | `pnpm contract:check` | PASS — frozen OpenAPI equality and generated client reproducibility |
| Diff hygiene | `git diff --check` | PASS |
| Independent read-only reviews | Python/Data Parsing; Nest/Data Integrity; PostgreSQL/transactions; Security | PASS — no unresolved P0/P1/P2 findings; final PostgreSQL review reran disposable R1-006B |
| Q0-03 compatibility | Detached temp worktree at Q0-03 head `3f8b9b569ab932a7cac223405cc7f36408e0a50a` plus the Q0-04 implementation patch; Python path explicitly pointed at combined worktree source | PASS — 66 Python tests and `pnpm test:r1-006b` passed; sentinel preserved; no cherry-pick conflict |
| Hosted CI | PR #38, first head `3df493c2cc20068a0df433a018c37ecca94cecc9` | IN PROGRESS — Actions run `41454494983`; recheck the exact head after pushing this documentation checkpoint |

No production database, named volume, or production service was used. PR #38 is open as Draft on `main`; final hosted CI must be confirmed against the exact pushed head after this documentation checkpoint. Compatibility worktree cleanup hit Windows `Filename too long`; its Git registration was removed, but an unregistered temp directory remains because the automatic command review rejected manual junction removal.
