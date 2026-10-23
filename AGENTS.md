# Codex project instructions — B2B R1

## Truth & scope

Read `docs/spec/00_README.md` and `docs/spec/02_RELEASE_SCOPE.md` first. The authoritative functional specification is `docs/spec/03_MASTER_TZ_R1.md`; the 108 approved historical decisions are in `docs/spec/01_DECISION_REGISTER.md`. Do not turn rejected options into features. In this project, the user orchestrates work and AI agents implement code.

## Build the approved MVP, not an ERP

R1: website/catalog, manual supplier parser and per-item approvals, anonymous RFQs, Excel/CSV/text-PDF spec extraction, human engineering review, pricing/costing, approved PDF + protected quote portal. NO customer orders, warehouses, production flows, auto-substitutes, parser schedules, batch acceptance, EDI, 1C/bank/shipping APIs, CMS page builder, remote PLC access, independent task manager.

## Architecture

Next.js / NestJS / Python FastAPI ingestion / PostgreSQL / Redis; Docker on one Russian VDS. NestJS owns business permissions and state transitions. Python returns **staged candidates only** and never publishes catalog products. Money uses decimal and configured seller tax rules. Approved quote revisions are immutable.

## Working agreements

1. Before coding, identify requirement IDs and accepted/non-goal constraints. For broad work, make a small implementation plan.
2. Freeze or explicitly change DB schema, OpenAPI, auth and shared DTOs through a single owner. Do not parallel-edit shared contracts.
3. Independent parallel write agents use separate branches/worktrees; only one lead writer may use main under DIRECT_MAIN. Avoid editing another agent's files without coordination.
4. Implement one testable vertical slice at a time. Update unit/integration/E2E tests, docs and migrations with code.
5. Enforce server-side RBAC, source allowlists, safe file upload/download and privacy by default. Never expose cost, margin, internal comments or source parsing secrets to a quote recipient.
6. Manual approval gates are mandatory: supplier changes individually, engineer technical revision, manager quote approval. Never infer human approval from a green test.
7. Quote customer interest is not legal acceptance and does not create an order in R1. Do not overwrite any approved quote revision.
8. Preserve original imported files/rows and uncertainties; technical analogues are selected **only manually by engineers**.
9. For every task report changed paths, executed verification commands and actual results; do not claim an unexecuted test passed.
10. If a specification gap would change business behavior, stop and present a short choice to the product owner. Do not guess silently.

## Source of truth for each task

Use `docs/spec/09_ROADMAP_BACKLOG.md`, `docs/spec/08_TESTS_AND_ACCEPTANCE.md`, and `docs/spec/TASK_TEMPLATE.md`. Read only relevant subdomains plus cross-cutting invariants; avoid unnecessary full-context dumps.

## Git Delivery Policy

The owner grants standing authorization to create commits, push changes and merge PRs within the approved task scope under this policy. Separate owner confirmation is not required for each safe push or merge. The owner retains control of requirements, architecture, priorities and acceptance criteria. Git integration never replaces the manual business approvals above or authorizes production migrations.

At task start, classify risk and report the delivery mode. Choose the safer mode when uncertain; honor an explicit task-specific override within safety/GitHub constraints. A new branch for every task is not mandatory. Do not use DIRECT_MAIN for large implementations or downgrade delivery safeguards without sufficient grounds.

### DIRECT_MAIN

Permitted for bounded, low-risk documentation/instruction fixes, small code fixes, local refactoring without external behavior changes, additional tests, formatting/lint fixes, minor UI fixes without contract changes, and small development-tool changes that do not affect security or deployment.

All preconditions must hold:

- Local main is synchronized with freshly fetched origin/main; the worktree is clean or contains only known current-task changes.
- No parallel write agent shares the branch/worktree; only one lead writes main.
- No migrations, RBAC, session security, financial calculations or critical domain rules change.
- All applicable local checks pass; the diff contains no secrets or unrelated work.

Review the diff, commit meaningfully, fetch origin/main again and reconcile any advancement safely before a normal push to main. Never force-push or rewrite main history. Verify GitHub Actions for the exact pushed SHA; repair a CI failure with a new commit. If GitHub prohibits a direct push, switch to AUTO_MERGE without bypassing protection. DIRECT_MAIN is delivered only after the commit is pushed to main and its CI succeeds.

### AUTO_MERGE

Default for normal functional tasks: new features, multiple modules, APIs, significant UI/integration changes, databases/migrations, and security changes within an already approved contract. RBAC/API/DB involvement alone does not require manual merge.

Synchronize base main, create a short-lived feature branch, freeze scope/dependencies/acceptance criteria and any schema/API/auth contract, implement, run applicable unit/integration/contract/E2E and security checks, inspect the diff, commit, push and open a PR. Independent read-only QA/review is mandatory for high technical risk.

Merge autonomously only when **all** conditions hold:

- Every required GitHub check succeeds; none remains unfinished. Verify the current PR HEAD and the actual merge candidate if CI tests it; changed candidates require fresh applicable checks.
- No merge conflicts, open blocking findings, unresolved review threads that prohibit integration, or owner merge veto exist. HIGH/BLOCKER findings prohibit merge.
- Scope and decisions #1–108 are preserved; schema/API/auth changes match the frozen contract and applicable security tests pass.
- Branch protection, required approvals and all other GitHub rules are satisfied. Never bypass them.

Fix failures and repeat checks before merging. When conditions hold, perform the merge without another owner confirmation; do not stop at "ready for manual merge." Confirm successful integration, update local main safely, record its final SHA and update the task checkpoint/status. Verify any required post-integration checks. AUTO_MERGE is delivered only after the PR is merged and integration is confirmed. If blocked, report the exact reason and do not claim full delivery.

### REVIEW_REQUIRED

Obtain an owner decision for changes to approved business rules #1–108, substantial architecture/ADR changes, unapproved schema/permission/API contracts, deletion or potential loss of existing data, irreversible migrations requiring a decision, production infrastructure with downtime/data-loss risk, production secrets, substantial scope expansion, or a critical risk that cannot be resolved within approved requirements.

Safe preparation, branches, implementation within authorized scope, tests and a reviewable PR may proceed; the dangerous operation or merge requiring the decision stays blocked until approval. An approved contract plus independent review and successful checks permits AUTO_MERGE for otherwise eligible DB/API/security work. Merging code alone never authorizes applying production migrations.

### Shared safety and delivery report

Before changes verify branch/HEAD, origin/main freshness, known/unknown dirty paths, unfinished work by other agents and safe integration. Keep one change owner per iteration for schema, migrations, OpenAPI and permissions. Do not combine independent tasks into one PR without technical need.

No force-push to main, destructive reset/cleanup of unknown work, deletion of others' files or production data/volumes, bypass of checks, knowingly broken merges or ignored critical defects. Resolve conflicts without destroying another task's work or report the blocker. Preserve existing destructive-operation approval gates.

Report Task ID, delivery mode, changes/major files, actual tests, CI, PR if any, integration status PUSHED / MERGED / BLOCKED, delivered main SHA, limitations and next step. REVIEW_REQUIRED means prepared for an owner decision, not delivered. Unavailable CI or unverifiable results must be stated explicitly.

## VISUAL-FIRST / BATCH QUALITY GATE

For UI and design tasks, implement the agreed visual package in one iteration and make routine layout, type and spacing decisions autonomously. Before the owner approves the design, keep checks to the requested formatting/typecheck plus a quick browser review and desktop/mobile screenshots; skip full CI, runtime suites and separate reviews. Keep visual changes in the same Draft PR and do not merge before design approval. After approval, run one comprehensive frontend review and required checks, then follow the Git Delivery Policy. Never bypass repository protections. Backend, database, RBAC, API, security and FROZEN-contract changes keep their strict gates.

## Codex workflow skills (adapted from AC_Expluatation)

Repository skills are in `skills/README.md`; do **not** load every skill for every task. Pick the minimal set:
- For non-trivial or budget-sensitive work: `skills/efficient-orchestrator/SKILL.md`.
- Before risky/parallel work: `skills/repository-state-guard/SKILL.md`.
- When splitting independent workstreams: `skills/task-decomposer/SKILL.md`.
- Before pause/handoff: `skills/task-checkpoint/SKILL.md`.
- After interruption: `skills/task-resume/SKILL.md`.
- After parallel or high-risk edits: `skills/multi-agent-review/SKILL.md`.
- Before completing significant business features: `skills/traceability-checker/SKILL.md` and `skills/docs-impact/SKILL.md`.

A lead agent owns frozen contracts, migration ordering, merge/review and final correctness. Default BALANCED mode uses 0–2 parallel implementation writers only when file ownership is disjoint. Keep `.agent/tasks/R1-###/state.md` checkpoints consistent with Git and real test results. No automatic destructive reset/cleanup. The owner approves changed scope and strategic architecture; skills cannot supersede decisions #1–108.

See `docs/agent-workflow/README.md` for onboarding.
