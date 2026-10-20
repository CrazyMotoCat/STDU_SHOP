---
name: task-resume
description: Resume a paused STDU_SHOP Codex task after session interruption, agent handoff, or context/usage limit by validating saved state against Git.
---

# Task Resume — STDU_SHOP

Adapted from AC_Expluatation/skills/task-resume.

## Input
Exact R1-### task ID; no speculative next task.

## Minimal read
AGENTS.md; .agent/tasks/R1-###/state.md; git status; git log -10; git diff; exact backlog requirement. Read agent sub-state files only for parallel tasks.

## Verify before editing
1. Task ID and recorded branch agree with reality.
2. LAST_SAFE_COMMIT exists and relative history is understood.
3. Expected uncommitted changes match the actual diff.
4. No unexpected generated files, merge markers, partial migrations or corrupted configuration.
5. Run the cheapest relevant focused check; record its real result.

Classify CLEAN_AT_SAFE_COMMIT, DIRTY_EXPECTED, DIRTY_UNEXPECTED, DIVERGED or PARTIALLY_WRITTEN. On unexpected/diverged states return RESUME_SAFE: NO and escalate for reconciliation. Never reset unknown files or start the whole task from scratch.

For parallel work, reconcile each workstream with actual merged Git changes; do not rerun COMPLETE workers unless invalidated. If safe, start at stored NEXT_ACTION and avoid DO_NOT_REPEAT work.

## Output
RESUME_SAFE / TASK / REPOSITORY_STATE / LAST_SAFE_COMMIT / VERIFIED / COMPLETED / STATE_DRIFT / NEXT_ACTION / DO_NOT_REPEAT.
