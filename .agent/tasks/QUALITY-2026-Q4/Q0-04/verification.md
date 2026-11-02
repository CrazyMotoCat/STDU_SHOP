# Q0-04 verification matrix

Initial investigation base: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. The branch was rebased onto `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`; the seven intervening commits affected inquiry-download/security files and did not overlap Q0-04 paths. Local gates and compatibility passed on `0c394dee0e70ea08ab3112384fb0426fa4157f97`. A new fetch found `origin/main` at `74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d`; its only change since `e9af3a7` is `.agent/tasks/R1-010D/state.md`. Rebase this task onto `74dd704` and rerun checks before publication.

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
| Q0-03 compatibility | Detached temp worktree at Q0-03 head `3f8b9b569ab932a7cac223405cc7f36408e0a50a` plus Q0-04 commit `0c394dee0e70ea08ab3112384fb0426fa4157f97`; Python path explicitly pointed at combined worktree source | PASS — 66 Python tests and `pnpm test:r1-006b` passed; sentinel preserved; no cherry-pick conflict |
| Hosted CI | Exact final Draft PR head SHA | PENDING — push/Draft PR not created yet |

No production database, named volume, or production service was used. Hosted CI remains pending until the branch is pushed and the Draft PR is created. Compatibility worktree cleanup hit Windows `Filename too long`; its Git registration was removed, but an unregistered temp directory remains because the automatic command review rejected manual junction removal.
