# R1 Codex workflow hardening

This package adapts workflow/verification practices from AC_Expluatation without transferring CMMS implementation or .NET stack decisions. Source project main observed at commit 8362f59aded7c9a39dfaa29db5ed0bda82063e7d.

## Purpose
- Protect interrupted Codex work from loss and duplicate implementation.
- Cap agent parallelism and isolate write ownership.
- Enforce requirement-to-test traceability for critical workflows: parser candidate approvals, engineer revisions, costing and immutable quotations.
- Block destructive Git/Docker commands unless explicitly approved.

## Setup
Read AGENTS.md; keep original docs/spec requirements authoritative. Consult skills/README.md and invoke only matching skills. A baseline commit must exist before multi-agent writers start. Each R1 task has one owner for migrations and cross-module contracts.

## Git delivery and branch choice
The owner grants standing authorization for safe commits, pushes and merges under [AGENTS.md — Git Delivery Policy](../../AGENTS.md#git-delivery-policy). Choose and report a delivery mode at task start; prefer the safer mode if uncertain and honor explicit task overrides within safety/GitHub rules.

- **DIRECT_MAIN:** bounded low-risk fixes/docs/tests, synchronized main, clean/known task work, one lead writer, no migrations/RBAC/session-security/financial/critical-domain changes. Local checks and secret/diff review → commit → fetch/recheck origin/main → normal push → successful CI for the pushed SHA. A branch/PR is not required by formality. GitHub rejection of direct push switches to AUTO_MERGE.
- **AUTO_MERGE:** default for functional/multi-module/API/integration/DB or approved-contract security work. Use a short-lived feature branch/PR. Merge autonomously after all required checks/approvals on current HEAD/merge candidate pass, with no conflicts, blocking findings, prohibitive unresolved threads or owner veto. High risk requires independent read-only QA; HIGH/BLOCKER prohibits merge. Verify integration and update local main, SHA and checkpoint. Do not stop at a manual-merge handoff when all gates are satisfied.
- **REVIEW_REQUIRED:** owner decisions for changed business rules, architecture/ADR/scope, unapproved contracts, destructive/irreversible data changes or risky production operations/secrets. Prepare a reviewable result, keep the dangerous operation/decision-dependent merge blocked.

Independent parallel writers still use separate branches/worktrees; never share writes directly in main. Keep one owner for schema/migrations/OpenAPI/permissions. Do not bypass branch protection, approvals or checks, rewrite main history, delete unknown work or production data/volumes. Merging does not authorize production migrations or replace manual business approvals.

Delivery report: Task ID, mode, changed files, actual checks/CI, PR if any, PUSHED/MERGED/BLOCKED, delivered main SHA, limitations and next step. DIRECT_MAIN is delivered after push plus successful CI; AUTO_MERGE after merge and confirmed integration. State unavailable CI and exact blockers honestly.

## What is not included
No .NET scripts, no copied EAM domain entities, no RabbitMQ/Keycloak requirements and no business feature expansion. R1-001 has delivered runnable apps and application CI; use the current root README for actual commands.

## First-use verification (manual)
1. Find the exact skill file and read its frontmatter and stop conditions.
2. Run repository-state-guard, capture base SHA and choose the delivery mode for the current task.
3. Select BALANCED mode; do not create subagents without independent owned outputs.
4. Commit meaningful safe phases, complete delivery according to the selected mode and preserve task checkpoint when pausing.
5. Check traceability against docs/spec/08_TESTS_AND_ACCEPTANCE.md before closing R1 tasks.

## Source provenance
- https://github.com/CrazyMotoCat/AC_Expluatation/tree/main/skills
- https://github.com/CrazyMotoCat/AC_Expluatation/blob/main/AGENTS.md

The adaptation uses STDU_SHOP's existing AGENTS.md rules and does not override approved decision register.
