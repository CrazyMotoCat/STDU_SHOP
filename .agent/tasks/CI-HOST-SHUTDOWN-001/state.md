# CI-HOST-SHUTDOWN-001

TASK: CI-HOST-SHUTDOWN-001
STATUS: IMPLEMENTED_PENDING_HOSTED_DELIVERY
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: Local gate and independent review passed; publish PR and verify Ubuntu
UPDATED_AT: 2026-10-22
BRANCH: codex/ci-host-shutdown-001
LAST_SAFE_COMMIT: 9f89a3b

## COMPLETED
- Frozen lifecycle contract before implementation; baseline 14f51ac0bf11e7857f3ccc4aac366909eddda0f6.
- Direct app launches, dev/smoke recipes; POSIX groups and Windows atomic Job Objects, 5s grace + 3s force, idempotent cleanup, errors nonzero, PASS after verified shutdown.
- 16 lifecycle/recipe regressions; CI runs host smoke three consecutive times.
- Independent read-only QA PASS after its MEDIUM fix; no open code findings.
- README and task report updated. Scope/business/DB/API/ADR unchanged.

## VERIFIED
- PASS toolchain:check, db:validate, lint, format:check, typecheck, test, build through pnpm.
- PASS 30 Vitest + 5 pytest on Windows. Existing Starlette/httpx deprecation warning only.
- PASS 3x final Windows smoke:host; explicit bounded force in headless session, empty jobs/helper exits/free ports, dependency outage/restoration.
- PASS actual dev watchers/reloader startup and cancellation probe; all owned roots/helpers gone and ports free.
- PASS full pnpm smoke and pnpm compose:stop; existing volume creation times unchanged.
- Hosted Ubuntu/final SHA CI: NOT RUN yet. Details and evidence locations in docs/plans/CI-HOST-SHUTDOWN-001.md.

## UNCOMMITTED
- Only lead-owned lifecycle helpers/fixtures, smoke/ops/tasks integration, CI, README, task plan/checkpoint. No other writer.

## DECISIONS
- AUTO_MERGE replaces initial DIRECT_MAIN classification: native process control exceeds a small low-risk tool change under AGENTS.md. Owner standing authorization covers merge after all gates.
- Direct processes, no reload/watchers in smoke, hot reload in dev; built apps required before smoke.
- POSIX owned groups; Windows atomic Job Object via existing Python stdlib, no new infrastructure/dependency.
- Grace 5s + force 3s; final PASS after verified cleanup; failed cleanup nonzero.

## PENDING
- Commit/push scoped diff, open/attach PR, check actual Ubuntu candidate and head; merge only after all checks/rules/reviews permit. Verify final main SHA CI and record delivery evidence.

## BLOCKERS
- NONE.

## NEXT_ACTION
Review staged task-only diff and commit the verified implementation.

## DO_NOT_REPEAT
- No business/ADR/API/migration changes, R1-002, name/port-based kills, volume deletion or whole-runner termination.
- Never treat rerun success alone as resolution of another hang.
