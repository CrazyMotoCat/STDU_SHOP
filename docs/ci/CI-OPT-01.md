# CI-OPT-01 — FAST / FULL / post-merge

## Delivery and rollout state

`REVIEW_REQUIRED / SEPARATE_BRANCH / DRAFT_PR / NO_MERGE`. Branch `codex/ci-opt-01-fast-full`, isolated worktree. Application/API/schema/auth/RBAC/FROZEN contracts and PR #39 are outside scope.

This is a **parallel migration**. Existing `R1 foundation / quality-and-integration` remains enabled with every command intact. Its only operational adjustment isolates main runs by run ID and cancels only superseded PR runs; this prevents a later main commit replacing a pending predecessor. The original workflow is preserved in `legacy-ci.yml.txt`; tests compare exact ordered steps and configuration.

No repository protection is changed. New checks are not claimed to be mandatory in live GitHub settings. Keep the old required check until the owner completes `merge-gate-policy.md`. During this stage, Draft PRs still execute legacy FULL, so total waiting/runtime savings are **not yet activated**.

## Workflows and check contexts

| Workflow                 | Jobs / purpose                                                              | Triggers                                                                          |
| ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `ci.yml` — R1 foundation | Existing `quality-and-integration`, unchanged acceptance coverage           | Existing PR and main push                                                         |
| `ci-fast.yml` — FAST CI  | Parallel JavaScript, Python, frozen contracts; final **FAST CI** aggregator | Every PR update, including Draft; readiness/base changes; manual supplemental run |
| `ci-full.yml` — FULL CI  | Classify revision; **FULL CI**; final **FULL merge gate**                   | PR lifecycle; main push; merge queue; explicit dispatch with exact expected SHA   |

FAST always performs global static/unit/contract checks. Running all fast units is intentionally conservative: it covers dependencies and shared components without an incomplete per-test selector. No Docker, Chromium install, build or runtime suite runs in FAST. Installed dependencies and uv are locked; toolchain is checked. JS has ESLint, Prettier, recursive TypeScript/Prisma generation, Vitest and CI policy tests; Python has Ruff check/format, strict mypy including Windows process helper, parser/FastAPI pytest. Contract job runs all original contract commands and DB schema validation without connecting to a database.

Composite `.github/actions/ci-setup` removes repeated FAST setup. FULL keeps explicit original setup/commands to make parity auditable. It does not depend on a successful prior FAST run or reuse an old successful SHA.

## Routing matrix

| Paths                                                                                                   | Minimum route / areas                                            |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Explicit allowlisted homepage CSS/page, catalog presentation                                            | FAST frontend; catalog area also reported                        |
| Ordinary Markdown/TXT docs and task evidence                                                            | FAST docs validation (global static/format checks still run)     |
| Ingestion test fixtures/tests only                                                                      | FAST Python parser tests                                         |
| Ingestion implementation                                                                                | FULL: file parsing/upload boundary is security-sensitive         |
| Supplier staff UI                                                                                       | FULL: session, CSRF, idempotent mutations live in this component |
| Any Nest API, identity/session/RBAC, files/storage                                                      | FULL                                                             |
| Prisma, migrations, contracts/specs/ADRs, shared packages/DTOs                                          | FULL                                                             |
| Workflow/actions, classifier/gate/all CI scripts, Docker/infra, toolchain/config/lockfiles/dependencies | FULL                                                             |
| Shared or unknown path                                                                                  | FULL                                                             |
| Any deletion, rename/copy/type change, malformed/unavailable/empty diff                                 | FULL                                                             |

The proposed parser/supplier examples were minimums; actual project file ownership justifies the stronger security route above. Classifier uses NUL-delimited `git diff --name-status`, both rename paths, and the actual `git merge-base(baseSHA, headSHA)`. No filenames/ref names/PR titles/labels are evaluated as shell code. Buffer overflow, missing refs and parse exceptions force FULL. Failure of the planner itself still schedules FULL; final gate fails because classification did not succeed.

Ready PRs always FULL, including every later synchronize event. `ready_for_review` forces FULL even if stale metadata says Draft. Returning to Draft never makes an absent FULL pass. Edited events cover base retargets; titles/labels cannot opt out. There are no path filters or labels deciding whether a workflow exists.

## Exact revision and gate

Checkout is pinned to the event SHA. On PR events this is GitHub's test merge commit; the plan separately captures source head/base. FULL executes the original complete suite on that immutable checkout. Gate uses `always()` and depends on planner and FULL: only literal `success` passes. Skipped, neutral, cancelled, missing and failed results are rejected. A FAST-only Draft therefore intentionally has a failing FULL gate, not a false merge-ready success.

After FULL, the gate re-fetches the live PR and actual target-branch ref, requiring the same head SHA, base SHA, target SHA and merge candidate. Null/unmergeable/API errors fail closed. Main push runs every integrated event SHA, including older SHA runs if main subsequently advances; unique main run groups prevent cancellation. A successful old run is evidence for its own SHA only. Strict up-to-date protection or merge queue is needed against advancement **after** a completed gate; recheck live refs immediately before merge.

Dispatch requires a 40-character expected SHA equal to the selected ref/event SHA, actual checkout and freshly resolved ref. It always FULL. It is supplemental branch evidence, not a substitute for the required PR-associated gate. GitHub does not expose a newly added dispatch workflow until it is present on the default branch; do not assume it can be invoked before this Draft is accepted.

A PR can edit workflow/gate code. Repository-owned code cannot independently stop a malicious change from forging its own check or deleting policy. Required external trusted workflows (where supported) or an enforced independent policy-owner review plus protected required checks are necessary. Existing live protection was not authenticated; see the exact observations and owner actions in `merge-gate-policy.md`.

## Coverage and local verification

FULL preserves all original setup, all frozen contract commands, R1-004B schema/runtime, R1-002B, R1-006B, R1-007B, R1-010B, R1-010C, UI/catalog browser acceptance, five-service Docker smoke, three host lifecycle runs and unconditional stopped-state cleanup. Full lint/format/typecheck/test/build remain. Added policy tests/hygiene do not replace existing acceptance.

Run policy tests: `node --test scripts/ci/*.node.mjs`. They include a real temporary Git repository for merge-base/rename/missing-ref behavior, deletion/workflow removal, unknown paths, Draft→Ready→new HEAD plans, labels/title irrelevance, classifier errors, missing/skipped FULL, API identity changes, manual stale SHA, main concurrency and exact legacy/FULL step parity.

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm contract:check`, `pnpm test`, `pnpm build`, `git diff --check`. Workflows were checked locally with official actionlint v1.7.12, downloaded asset digest verified; no actionlint runtime dependency was added. Secret check is deliberately a limited added-line signature scan (private keys, GitHub/PAT/AWS identifiers and unexpected .env files), never a guarantee of complete secret detection; suspected values are not printed.

Hosted legacy FULL, new FULL and FAST must all be verified on the final PR HEAD. Routing simulations are not hosted lifecycle evidence or actual six-scenario benchmark runs. See `benchmark.md` for measured versus pending data.

## Rollback

Before activation: close/revert this Draft; legacy command coverage remains unchanged. After separately approved activation: restore legacy `quality-and-integration` as required first, verify a fresh current-head legacy run, then revert new workflows/policy. Never remove the active required gate before the replacement is green and enforced. Do not change production or disable protections to repair a CI failure.
