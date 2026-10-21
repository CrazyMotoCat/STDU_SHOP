---
name: repository-state-guard
description: Inspect Git safety before broad Codex edits, concurrent writers, migrations, destructive scripts, or interrupted-session recovery in STDU_SHOP.
---

# Repository State Guard — STDU_SHOP

Adapted from AC_Expluatation/skills/repository-state-guard. Git recovery must not depend on conversation history.

## Read-only inspection first
Run git status --short --branch; git log -1 --oneline; git diff --stat; git diff; and check untracked files. Fetch origin, compare main with origin/main and inspect worktrees/unfinished writers. Confirm the base branch, worktree and commit. Never claim a clean state just because tests pass.

Classify NOT_GIT, UNBORN, CLEAN_BASELINE, DIRTY_EXPECTED, DIRTY_UNKNOWN or PARTIAL_OR_CORRUPT.

## Safety gate
- CLEAN_BASELINE -> SAFE.
- Known working changes with a verified checkpoint -> SAFE_WITH_CHECKPOINT.
- Substantial files but no commit -> BASELINE_REQUIRED.
- Unknown changes -> RECONCILIATION_REQUIRED; do not claim another agent's work.
- Unresolved merge markers, truncated migrations/configs or risky destructive action -> BLOCKED.

Before parallel writes require a known base commit, isolated branches/worktrees for independent writers, clear WRITE_ALLOW per writer and no conflicting migration/contract ownership. Only one lead may write main. PRs target main; unfinished feature experiments cannot use DIRECT_MAIN.

## Delivery mode gate
Use the owner's standing [Git Delivery Policy](../../AGENTS.md#git-delivery-policy); a separate branch is not mandatory for every task. Report DIRECT_MAIN / AUTO_MERGE / REVIEW_REQUIRED at task start; use the safer mode if uncertain.

DIRECT_MAIN requires **all** of: bounded low risk, local main synchronized with freshly fetched origin/main, clean or known current-task changes, no parallel writer in the same branch/worktree, no migrations/RBAC/session-security/financial/critical-domain-rule changes, successful applicable local checks and a reviewed secret-free task-only diff. Commit, fetch/recheck origin/main before a normal push, safely reconcile advancement, then verify Actions for the exact pushed SHA. Fix failed CI with a new commit. Do not force-push, reset or rewrite main history. If direct push is prohibited, use AUTO_MERGE without bypassing GitHub protection.

AUTO_MERGE uses a feature branch/PR and may finish autonomously only after current HEAD/merge-candidate checks, required approvals and other GitHub rules pass, no conflicts/blocking findings/prohibitive unresolved threads/owner veto remain, and scope/contracts/security requirements hold. High technical risk requires independent read-only review; HIGH/BLOCKER prevents merge. Confirm integration, update local main safely and record SHA/checkpoint.

REVIEW_REQUIRED keeps the dangerous operation or decision-dependent merge blocked for new business/architecture/scope decisions, unapproved contracts, data-loss/irreversible-migration risk, risky production changes or production secrets. Approved DB/API/security contracts alone do not force manual merge; production migration execution is separate authorization. Report precise blockers, never bypass protection or claim delivery from local checks alone.

## Destructive command policy
Never automatically run git reset --hard, git clean -fd, git restore ., docker compose down -v, DROP DATABASE or rm -rf on unknown paths. Development-data reset requires explicit DEV environment, local Docker context, -WhatIf or dry-run and user confirmation. No production reset.

## Secret hygiene
Before commits: inspect changes for passwords, API keys, .env, credentials, supplier access secrets, client RFQ attachments, generated artifacts and private source datasets. Do not print secret values.

## Output
REPOSITORY_SAFETY / GIT_STATE / BASE_COMMIT / DIRTY_SUMMARY / SECRET_HYGIENE / MULTI_AGENT_WRITES / REQUIRED_ACTION.

This inspection gate does not itself perform Git mutations. Subsequent delivery uses the owner's standing authorization and selected mode; destructive actions retain their separate approval requirements.
