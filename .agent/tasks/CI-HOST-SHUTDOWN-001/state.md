# CI-HOST-SHUTDOWN-001

TASK: CI-HOST-SHUTDOWN-001
STATUS: COMPLETED
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: Implementation merged and verified in main; delivery evidence recorded
UPDATED_AT: 2026-10-22
BRANCH: main
LAST_SAFE_COMMIT: 759ceffea9c0c5d974e6855ef2fb292bd0a8a004

## COMPLETED
- Frozen lifecycle contract before implementation; baseline 14f51ac0bf11e7857f3ccc4aac366909eddda0f6.
- Direct app launches, dev/smoke recipes; POSIX groups and Windows atomic Job Objects, 5s grace + 3s force, idempotent cleanup, errors nonzero, PASS after verified shutdown.
- 16 lifecycle/recipe regressions; CI runs host smoke three consecutive times.
- Independent read-only QA PASS after its MEDIUM fix; no open code findings.
- README and task report updated. Scope/business/DB/API/ADR unchanged.
- PR #3 merged after successful exact-candidate CI and rule/review checks; local main fast-forwarded safely. Post-merge CI SUCCESS for 759ceffea9c0c5d974e6855ef2fb292bd0a8a004.

## VERIFIED
- PASS toolchain:check, db:validate, lint, format:check, typecheck, test, build through pnpm.
- PASS 30 Vitest + 5 pytest on Windows. Existing Starlette/httpx deprecation warning only.
- PASS 3x final Windows smoke:host; explicit bounded force in headless session, empty jobs/helper exits/free ports, dependency outage/restoration.
- PASS actual dev watchers/reloader startup and cancellation probe; all owned roots/helpers gone and ports free.
- PASS full pnpm smoke and pnpm compose:stop; existing volume creation times unchanged.
- Ubuntu PR CI 39616862891, actual candidate 0afcde103400a37403de8c5109372a87a4db814e: attempt 1 SUCCESS. Candidate tree identical to implementation HEAD 75616148c48306719c440f914e62096293195566.
- Ubuntu main CI 39617956282, SHA 759ceffea9c0c5d974e6855ef2fb292bd0a8a004: attempt 1 SUCCESS. 29 Vitest PASS/1 Windows-only skip + 5 pytest, complete gate/Compose and 3 consecutive host smoke. PR CI also ran 3 host smoke; all six stopped gracefully with no owned orphans.
- This checkpoint/report-only follow-up has no implementation changes. Verify CI for its containing main commit before the final delivery message; report that SHA/run externally, not as an impossible self-reference in this file.

## UNCOMMITTED
- NONE after the delivery-record commit; only this checkpoint and task report are in that commit.

## DECISIONS
- AUTO_MERGE replaces initial DIRECT_MAIN classification: native process control exceeds a small low-risk tool change under AGENTS.md. Owner standing authorization covers merge after all gates.
- Direct processes, no reload/watchers in smoke, hot reload in dev; built apps required before smoke.
- POSIX owned groups; Windows atomic Job Object via existing Python stdlib, no new infrastructure/dependency.
- Grace 5s + force 3s; final PASS after verified cleanup; failed cleanup nonzero.

## PENDING
- No implementation work remains. R1-002 requires a separate bounded task/contract; not started.

## BLOCKERS
- NONE.

## NEXT_ACTION
Report the final main SHA/CI and propose R1-002 contract preparation without starting it.

## DO_NOT_REPEAT
- No business/ADR/API/migration changes, R1-002, name/port-based kills, volume deletion or whole-runner termination.
- Never treat rerun success alone as resolution of another hang.
