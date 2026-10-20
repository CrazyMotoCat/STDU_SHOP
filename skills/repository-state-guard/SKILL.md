---
name: repository-state-guard
description: Inspect Git safety before broad Codex edits, concurrent writers, migrations, destructive scripts, or interrupted-session recovery in STDU_SHOP.
---

# Repository State Guard — STDU_SHOP

Adapted from AC_Expluatation/skills/repository-state-guard. Git recovery must not depend on conversation history.

## Read-only inspection first
Run git status --short --branch; git log -1 --oneline; git diff --stat; git diff; and check untracked files. Confirm the base branch, worktree and commit. Never claim a clean state just because tests pass.

Classify NOT_GIT, UNBORN, CLEAN_BASELINE, DIRTY_EXPECTED, DIRTY_UNKNOWN or PARTIAL_OR_CORRUPT.

## Safety gate
- CLEAN_BASELINE -> SAFE.
- Known working changes with a verified checkpoint -> SAFE_WITH_CHECKPOINT.
- Substantial files but no commit -> BASELINE_REQUIRED.
- Unknown changes -> RECONCILIATION_REQUIRED; do not claim another agent's work.
- Unresolved merge markers, truncated migrations/configs or risky destructive action -> BLOCKED.

Before parallel writes require a known base commit, isolated branches/worktrees, clear WRITE_ALLOW per writer and no conflicting migration/contract ownership. PRs target main; do not push unfinished feature experiments directly to main.

## Destructive command policy
Never automatically run git reset --hard, git clean -fd, git restore ., docker compose down -v, DROP DATABASE or rm -rf on unknown paths. Development-data reset requires explicit DEV environment, local Docker context, -WhatIf or dry-run and user confirmation. No production reset.

## Secret hygiene
Before commits: inspect changes for passwords, API keys, .env, credentials, supplier access secrets, client RFQ attachments, generated artifacts and private source datasets. Do not print secret values.

## Output
REPOSITORY_SAFETY / GIT_STATE / BASE_COMMIT / DIRTY_SUMMARY / SECRET_HYGIENE / MULTI_AGENT_WRITES / REQUIRED_ACTION.

This is a gate only: it does not silently commit, reset, delete or merge.
