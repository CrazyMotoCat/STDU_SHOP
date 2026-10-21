# CI-HOST-SHUTDOWN-001

Delivery: DIRECT_MAIN, one writer, baseline 14f51ac0bf11e7857f3ccc4aac366909eddda0f6. Only local dev/test lifecycle tooling and its checks/documentation change; no business/API/schema/ADR changes.

## Evidence and diagnosis

Run 39606545231 attempt 1: PASS at 13:18:28 UTC preceded shutdown; Uvicorn server 6654 finished, but at cancellation 13:22:58 runner cleaned up uv 6627, reloader 6643 and python 6653. This proves incomplete lifecycle completion and unbounded waiting, not the exact internal signal race.

Installed concurrently 10.0.6 runs commands through a shell. The recipes add pnpm and uv wrappers; tsx/Next development and Uvicorn reload add children. Uvicorn BaseReload.shutdown terminates and joins its multiprocessing worker. Concurrent leaf/root signals and wrapper exit can leave a reloader/resource tracker alive. Confidence: high in missing shutdown bounds/PASS ordering; medium in the precise wrapper/reloader race.

## Lifecycle contract before implementation

- Start application executables directly, shell=false. Smoke builds and starts Next/Nest without watchers and uses the locked venv Python without uv/reload. Normal dev retains hot reload.
- Each POSIX app gets its own process group; signal only groups created by this supervisor, including after leader exit.
- On Windows a Python standard-library helper owns one kernel Job Object per app. Assign the job atomically at process creation; KILL_ON_JOB_CLOSE contains descendants even if the leader/helper exits. No extra package/service/runtime. No process-name or port-based termination.
- Grace period 5 seconds, force period 3 seconds. Signal gracefully, then terminate only owned group/job; verify empty boundary and supervisor exit. A failed deadline produces a diagnostic nonzero result and releases owned handles instead of awaiting an unresolved Promise forever.
- Stop is idempotent. Install cancellation handlers before spawning. Startup errors, unexpected app exit, operation exceptions and SIGINT/SIGTERM all pass through bounded cleanup. Preserve both operation and cleanup failures.
- PASS is emitted only after cleanup and port-release checks. Port checks verify availability; they never authorize killing a process. Successful forced fallback is reported explicitly; inability to prove cleanup fails the smoke.
- PostgreSQL/Redis outage restoration stays in finally; never delete containers' data or volumes.

## Implementation and verification plan

1. scripts/process-lifecycle.mjs and scripts/windows_job.py: owned boundaries, startup/cancellation, bounded stop and diagnostics.
2. scripts/host-apps.mjs, smoke.mjs, ops.mjs: direct recipes, separate smoke/dev modes, finally cleanup and PASS ordering; lib.mjs only if exit reporting requires it.
3. Controlled fixtures/regressions: normal stop/restart, exceptions, partial startup, early parent exit with live descendants/stdio, forced escalation/failure, cancellation, foreign sentinel protection and no residual owned children.
4. Root quality gate includes the Windows Python helper. Windows local smoke:host three times; Ubuntu CI repeats it three times. Full Compose smoke remains required; volumes preserved.
5. Read-only independent review of ownership/bounds; task-only diff/secret check, normal commit/push, verify final main SHA and exact hosted CI. No retry-only resolution of another hang.

## Results

NOT RUN: implementation/regression/repeated smoke/final CI pending. Final evidence will distinguish Windows local results from Ubuntu hosted results.
