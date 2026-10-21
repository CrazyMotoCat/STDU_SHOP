# CI-HOST-SHUTDOWN-001

TASK: CI-HOST-SHUTDOWN-001
STATUS: IN_PROGRESS
DELIVERY_MODE: DIRECT_MAIN
CHECKPOINT_STATUS: SAFE
PHASE: Lifecycle contract frozen before implementation
UPDATED_AT: 2026-10-22
BRANCH: main
LAST_SAFE_COMMIT: 14f51ac0bf11e7857f3ccc4aac366909eddda0f6

## COMPLETED
- Read task/policy and current helpers; clean baseline equals origin/main, one checkout/writer.
- Inspected failed attempt logs and installed Uvicorn/concurrently source/docs. PASS preceded incomplete shutdown; uv/reloader/python survived until runner cancellation.
- Recorded lifecycle ownership/bounds contract in docs/plans/CI-HOST-SHUTDOWN-001.md; independent read-only QA identified early-parent-exit and retained-stdio cases.

## VERIFIED
- git status/fetch/rev-parse/worktree: PASS, clean expected baseline.
- Runtime checks for the new implementation: NOT RUN.

## UNCOMMITTED
- Lead-owned plan and this checkpoint; subsequent lifecycle tooling/tests/docs are the same task.

## DECISIONS
- Direct processes, no reload/watchers in smoke, hot reload in dev.
- POSIX owned groups; Windows atomic Job Object via existing Python stdlib, no new infrastructure/dependency.
- Grace 5s + force 3s; final PASS after verified cleanup; failed cleanup nonzero.

## PENDING
- Implement, regression, root quality, 3x Windows + 3x Ubuntu host smoke, independent review and final SHA CI.

## BLOCKERS
- NONE.

## NEXT_ACTION
Implement owned process boundaries and regression fixtures under scripts/.

## DO_NOT_REPEAT
- No business/ADR/API/migration changes, R1-002, name/port-based kills, volume deletion or whole-runner termination.
