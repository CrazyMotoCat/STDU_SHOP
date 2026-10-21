# CI-HOST-SHUTDOWN-001

Delivery: AUTO_MERGE, one writer, baseline 14f51ac0bf11e7857f3ccc4aac366909eddda0f6. Initially classified DIRECT_MAIN; native Windows ownership/control and its verification exceed a small low-risk tool change, so use the safer PR/review/CI route required by AGENTS.md. Only local dev/test lifecycle tooling and its checks/documentation change; no business/API/schema/ADR changes.

## Evidence and diagnosis

Run 39606545231 attempt 1: PASS at 13:18:28 UTC preceded shutdown; Uvicorn server 6654 finished, but at cancellation 13:22:58 runner cleaned up uv 6627, reloader 6643 and python 6653. This proves incomplete lifecycle completion and unbounded waiting, not the exact internal signal race.

Installed concurrently 10.0.6 runs commands through a shell. The recipes add pnpm and uv wrappers; tsx/Next development and Uvicorn reload add children. Uvicorn BaseReload.shutdown terminates and joins its multiprocessing worker. Concurrent leaf/root signals and wrapper exit can leave a reloader/resource tracker alive. Confidence: high in missing shutdown bounds/PASS ordering; medium in the precise wrapper/reloader race.

## Lifecycle contract before implementation

- Start application executables directly, shell=false. Smoke requires `pnpm build`, starts built Next/Nest without watchers and uses the locked venv Python without uv/reload. Normal dev retains hot reload. Build runs separately in the quality gate, before starting the managed apps.
- Each POSIX app gets its own process group; signal only groups created by this supervisor, including after leader exit.
- On Windows a Python standard-library helper owns one kernel Job Object per app. Assign the job atomically at process creation; KILL_ON_JOB_CLOSE contains descendants even if the leader/helper exits. No extra package/service/runtime. No process-name or port-based termination.
- Launch this stdlib-only helper with the venv's configured base interpreter directly, avoiding the Windows venv executable's extra redirector. Application Python still uses the locked venv.
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

### Windows local verification, 2026-10-22

- PASS: `pnpm toolchain:check`, `pnpm db:validate`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `pnpm test`: 30 Vitest (16 new lifecycle/recipe regressions), 5 pytest. One existing Starlette/httpx deprecation warning; no failure.
- PASS: three consecutive `pnpm smoke:host` on the final implementation, all exit 0. Each verifies readiness/liveness, PostgreSQL and Redis outage/restoration, shutdown, and free ports; each next launch succeeds. Headless Windows cannot deliver a console event here: explicit escalation after 5s, empty Job Objects and exited helpers confirmed inside the 3s force budget. Earlier three-run development series also passed, but the final series is the acceptance evidence.
- PASS: actual normal dev recipes (Next dev, tsx watch, Uvicorn reload) became ready; injected cancellation completed bounded cleanup. Empty jobs, exited application roots/helpers and free 3000/3001/8000 verified. This does not claim an interactive keyboard/console test.
- PASS: `pnpm smoke` for all five Compose services and both dependency outages, followed by `pnpm compose:stop`. All task services stopped; no volumes removed.
- Existing volume creation times unchanged: `stdu-shop-r1-001_postgres-data` 2026-10-20T15:07:00Z; `stdu-shop-r1-001_private-files` 2026-10-20T15:18:49Z. No migration, DELETE/FLUSH, reset or volume removal commands executed.
- PASS independent read-only QA after fixing its MEDIUM synchronous-throw/signal finding. No open findings. Review covered ownership, early parent/helper death, stream handles and error/PASS ordering; QA did not independently rerun tests.
- Local raw logs: ignored `.local/evidence/ci-host-shutdown-*.log`, final host series `windows-final-1..3.log`. Local dev probe is also ignored; it is not an additional public command.

### Regression coverage

Controlled Node fixtures and short test deadlines cover normal tree shutdown/restart; exception; immediate stop; partial launch failure; SIGINT/SIGTERM and handler removal; synchronous exception plus signal during cleanup; combined operation/shutdown errors; early parent exit with inherited pipes; stubborn child force escalation; foreign sentinel survival; bounded failed cleanup; CLI nonzero/no final PASS with captured pipes; Windows actual-helper crash; direct smoke recipes/no reload; retained dev watchers/reload. Assertions check owned PIDs, free ports and survival of the separate foreign sentinel. The helper-crash test is Windows-only and explicitly skipped on Ubuntu.

### Hosted delivery

Implementation delivered through [merged PR #3](https://github.com/CrazyMotoCat/STDU_SHOP/pull/3), AUTO_MERGE after all gates; no required approvals/protection or unresolved/blocking reviews were bypassed. Independent read-only QA passed. Local main updated by fast-forward, no reset/rewrite.

| Evidence              | Exact SHA                                  | Result                                                                                                   |
| --------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Implementation HEAD   | `75616148c48306719c440f914e62096293195566` | Windows local gate above                                                                                 |
| Actual PR CI checkout | `0afcde103400a37403de8c5109372a87a4db814e` | [Run 39616862891](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39616862891), attempt 1 SUCCESS |
| Integrated main       | `759ceffea9c0c5d974e6855ef2fb292bd0a8a004` | [Run 39617956282](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/39617956282), attempt 1 SUCCESS |

All three commits have identical Git tree `88e920719de52cc6d7f3937f7e125ef94cf6f8fe`. Logs confirm exact checkout, full quality gate, 29 Vitest PASS + 1 deliberate Windows-only skip, 5 pytest PASS, full Compose smoke and **three consecutive host smoke** in each Ubuntu run. All six host shutdowns are `forced=false`; final PASS follows shutdown, next launch has no port conflict. Runner cleanup reports no surviving owned uv/uvicorn/python processes. No CI retry was needed for this task.

The subsequent delivery-record commit changes only this report and the task checkpoint. Its full SHA and successful main push CI are reported in the final delivery message/PR description after verification. The immutable source-code acceptance SHA is the integrated main SHA above; this avoids a self-referential commit hash inside its own report.

### Remaining limits

The precise old wrapper/reloader race has not been reproduced deterministically. The new tests reproduce its relevant failure modes instead. Windows helper uses Windows 10+/Server 2016+ native APIs and the already installed locked Python runtime; local tests cover the current Windows host. Successful force fallback is observable and acceptable; an unverified deadline or helper failure is nonzero. Operating-system/runner hard termination remains outside graceful application cleanup.

### Primary implementation references

- [Microsoft process attributes: Job List and Handle List](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).
- [Microsoft Job Objects: membership and kill-on-close](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- [CPython 3.14.3 Windows venv launcher](https://github.com/python/cpython/blob/v3.14.3/PC/venvlauncher.c): reason to launch the stdlib helper through the configured base interpreter.
