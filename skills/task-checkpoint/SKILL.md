---
name: task-checkpoint
description: Persist a verifiable Codex task checkpoint before a pause, context/usage limit, branch handoff, or after a substantial atomic phase.
---

# Task Checkpoint — STDU_SHOP

Adapted from AC_Expluatation/skills/task-checkpoint. The repository, not chat memory, records recoverable progress.

## File
Use .agent/tasks/R1-###/state.md, following skills/_templates/task-state.template.md. For parallel streams use .agent/tasks/R1-###/agents/<agent-id>.md.

## Before writing
Check the exact backlog item, current branch, git status, git log, diff and actual check results. Check for unexpected worktree changes belonging to others.

## Minimum checkpoint
- TASK, STATUS, PHASE, CHECKPOINT_STATUS, LAST_SAFE_COMMIT and BRANCH.
- COMPLETED: only objectively existing changes.
- VERIFIED: exact commands run and real PASS/FAIL results; never infer tests passed.
- UNCOMMITTED: expected dirty files and ownership.
- DECISIONS: frozen R1 contracts and explicit owner decisions, not guesses.
- BLOCKERS and NEXT_ACTION: exactly one concrete executable next action.
- DO_NOT_REPEAT: finished work to avoid duplicating.

SAFE is permitted only when the atomic slice is syntactically valid, focused tests/builds actually pass and unfinished migrations are identified. Otherwise UNSAFE with details. A state file is not a substitute for a recoverable Git commit. Do not commit without repo task policy/user authorization.

## End
If invoked only for handoff, write the checkpoint and stop; do not start another large task.
