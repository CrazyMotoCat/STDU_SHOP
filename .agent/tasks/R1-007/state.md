# R1-007 checkpoint

- Task: R1-007A Supplier Domain Contract
- Delivery mode: AUTO_MERGE (owner approved the exact contract source SHA and authorized finalization/integration)
- Baseline: `1e3c24cdd04628180f600f28aab0f88c37f23eb8`
- Work branch: `codex/r1-007a-supplier-contract`
- Status: Product owner approved proposed R1-007A SHA `241b9c1a6d6e57b7ff1999e1aae46b66c33cb131` with OD-007A-01…07 on 2026-10-25. Contract artifacts matched that exact source SHA before status finalization; FROZEN 1.0.0 metadata and checksum manifest are recorded. PR #16 remains Draft pending final CI and integration.
- CI stabilization: R1-006B test-only PR #17 merged at `0f3fd681ee16bc88490bde6f55e2031c63bc82af`; hosted Actions run 40108699130 passed on the synchronized branch. The target race test passed three isolated disposable PostgreSQL runs and the full R1-006B runtime suite passed once.
- Frozen source checksums and post-freeze artifact checksums are recorded in `docs/contracts/R1-007-frozen-manifest.json`.
- Frozen dependencies: R1-002 1.0.0, R1-004 1.0.0, R1-006A 1.0.0; their artifacts must remain unchanged.
- Parallel R1-018A was integrated independently at `e2e77a01a55511d3224f79b8a946f5f2c5dafcd4`; its branch/worktree was not modified for this task.
- Verified: checker and OpenAPI validation PASS; 21 contract regression tests PASS; OpenAPI TypeScript generation PASS; Prettier and `git diff --check` PASS. The required GitHub workflow now runs the frozen supplier checker and tests.
- Next: publish the freeze package to PR #16, verify successful Actions for its exact HEAD, mark Ready and merge without bypassing GitHub rules. Then create R1-007B from freshly fetched `main`.
- R1-007B: owner-approved to start only after R1-007A is integrated; no production migration, deployment or live permission grants.
