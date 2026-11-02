# Q0-04 verification matrix

Initial investigation base: `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`. On 2026-11-02, a fresh fetch found `origin/main` at `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`, seven commits ahead in inquiry-download/security files. Those commits do not touch Q0-04 source/test paths. Branch synchronization and exact post-sync reruns remain pending.

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
| Q0-03 compatibility | Temporary combined worktree at Q0-03 Draft PR head, then Q0-04 commit | NOT RUN — do after the Q0-04 commit and base sync |
| Hosted CI | Exact final Draft PR head SHA | PENDING — push/Draft PR not created yet |

All local results above apply to the current implementation before rebasing onto the newly fetched `origin/main`. Repeat required checks after synchronization. No production database, named volume, or production service was used.
