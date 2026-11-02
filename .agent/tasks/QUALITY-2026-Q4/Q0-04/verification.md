# Q0-04 verification after Q0-03 merge

Date: 2026-11-03 (Asia/Vladivostok). Source commit: `a27af9cc459d8ee14e1daac17fe12678c4166566`; base main `d88a5b40eef6ba7db091d5dfb6a1b41249cfd617`.

| Gate | Actual result |
| --- | --- |
| `pnpm lint` | PASS, ESLint and Ruff |
| `pnpm format:check` | PASS, Prettier and Ruff format |
| `pnpm typecheck` | PASS, TypeScript and mypy; normal Prisma generation |
| `pnpm contract:check` | PASS, frozen OpenAPI equality and generated-client reproducibility |
| `pnpm test` Python/FastAPI | 66 passed, 0 skipped; one existing Starlette/httpx warning |
| `pnpm test` Vitest | 114 passed, 91 environment-gated skips; 15 files passed, 5 skipped |
| `pnpm build` | PASS, API/web/staff client and ingestion wheel/sdist |
| `pnpm test:r1-006b` | PASS, isolated PostgreSQL/Redis/parser/API/browser harness, database sentinel preserved |
| Observed dedicated runtime repetition | 7 passed, 0 skipped; captured child Vitest stdout using an ignored observer, no tracked harness changes |
| `git diff --check` | PASS |
| Independent Python review | PASS, explicit local-module path check and independent 66 passed / 0 skipped |
| Independent Nest integrity review | PASS, final diff and runtime assertion retention |
| Independent PostgreSQL review | PASS, transaction/staging/audit/owned-file compensation retained; executable runtime supplied by lead |
| Independent security/regression review | PASS, no frozen/schema/RBAC/storage changes; no P0/P1/P2 |

Observed disposable project `stdu-r1-006b-test-79220-24006e95`, loopback PostgreSQL/Redis ports 53269/53270, no named volumes, sentinel preserved, normal owned-resource cleanup. No production/shared database or global Docker cleanup.

Dedicated runtime executes all seven tests: E2E-03 manual preview/decision; late XLSX row rejection before persistence; private idempotent replay; visibility race; pg_temp shadowing resistance; Q0-04 quoted CSV/override/exact identity; Q0-04 typed Boolean/numeric SKU. The 91 skips from the ordinary unit command do not describe this separately enabled runtime.

Independent retention checks: all 27 Q0-03 parser and 6 health test functions remain; two reviewed fixture/assertion updates strengthen existing coverage. All 15 Q0-04 parser and 13 health functions retained unchanged. Parametrization yields 66 total Python cases. Runtime diff against new main is +744/-0; Q0-03 late-failure test remains. All XLSX parser functions are unchanged against new main; only CSV inference/parsing functions differ.

Full successful local output is retained in lead-owned integration worktree `.local/integration-evidence/q004-after-main-*.log`. Earlier Q0-03/Q0-04 preparation evidence is preserved publicly in https://github.com/CrazyMotoCat/STDU_SHOP/pull/35#issuecomment-6580327869 .

Hosted current-head CI is an external gate: inspect exact PR #38 HEAD and its workflow runs. The final PR verification comment records the resulting SHA/run/outcome without changing that verified HEAD. Prior run 41454777559 applies only to historical de32d16e HEAD.
