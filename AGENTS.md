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
3. Use separate branches/worktrees for independent write agents; avoid editing another agent's files without coordination.
4. Implement one testable vertical slice at a time. Update unit/integration/E2E tests, docs and migrations with code.
5. Enforce server-side RBAC, source allowlists, safe file upload/download and privacy by default. Never expose cost, margin, internal comments or source parsing secrets to a quote recipient.
6. Manual approval gates are mandatory: supplier changes individually, engineer technical revision, manager quote approval. Never infer human approval from a green test.
7. Quote customer interest is not legal acceptance and does not create an order in R1. Do not overwrite any approved quote revision.
8. Preserve original imported files/rows and uncertainties; technical analogues are selected **only manually by engineers**.
9. For every task report changed paths, executed verification commands and actual results; do not claim an unexecuted test passed.
10. If a specification gap would change business behavior, stop and present a short choice to the product owner. Do not guess silently.

## Source of truth for each task

Use `docs/spec/09_ROADMAP_BACKLOG.md`, `docs/spec/08_TESTS_AND_ACCEPTANCE.md`, and `docs/spec/TASK_TEMPLATE.md`. Read only relevant subdomains plus cross-cutting invariants; avoid unnecessary full-context dumps.
