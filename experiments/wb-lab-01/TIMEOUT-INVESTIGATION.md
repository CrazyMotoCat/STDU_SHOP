# E0a timeout investigation — bounded repeat

The prior run `f031a15fd2554ba3a8df9fe802ecdc7f` ended BLOCKED/TimeoutExpired with confirmed cleanup. It did not record per-command timings. Read-only Docker events for its exact container show attach at 13:34:14.063 UTC, start at 13:34:14.513, SIGKILL at 13:34:17.194, exit 137 and destroy at 13:34:17.380. This sequence supports a timeout while the parent waited on start/attach, followed by cleanup. It does not establish how long a successful cold startup would have needed. Read-only image inspect and inventory checks later took 125 ms and 80 ms.

The previous 3-second cap included startup and execution under a 0.25 CPU quota. The revised provisional operation caps are 3 seconds for inspect/list/remove, 5 seconds for create and 12 seconds for start/attach. All are clipped by the original 30-second workload deadline. The 12-second value allows up to the existing 8-second in-probe alarm plus startup, subject to the same outer budget. These are bounded diagnostic budgets for the repeat, not measured production limits. A command that returns after its assigned cap or the global deadline is rejected even when its exit code is zero.

Each operation records a fixed phase and operation name, elapsed milliseconds, actual timeout budget and exception type. No argument vector, arbitrary output or exception message from subprocess is written to evidence. Parent operations and cleanup are recorded separately. Watchdog reports its failed operation through a bounded small pipe message. Failed workload diagnostics survive successful cleanup. Foreign inventory is compared after cleanup as before.

## Evidence archival

`archive_timeout.py ARCHIVE_CONFIRMED_TIMEOUT` is restricted to the exact prior run and expected container ID. It validates confirmed cleanup and foreign-inventory preservation in the saved JSON, rechecks the known daemon ID, and confirms container ID, name and volume absence using read-only inspect. It then locks the root directory and moves only that owned run directory to its sibling archive. It preserves evidence and syncs both directories. A newly created archive has inherited SGID cleared explicitly with chmod 0700. A pre-existing archive with SGID or unexpected owner/mode is refused, and is retained for investigation.

This archival procedure does not remove Docker resources and refuses any unexpected lab-root contents. Source evidence is retained locally and must be reviewed before sharing.

## Autonomous execution sequence

Owner authorized this sequence for this task. Retain the pinned image and reviewed HEAD, run targeted offline checks and independent review, and verify hosted FAST/FULL. Then archive only the known failed run, repeat the read-only host gate and execute one bounded E0a probe. Preserve the new JSON and exact resource ledger, verify cleanup and foreign inventory, and stop on unconfirmed ownership, cleanup or watchdog/power issues. No E0b–E5 are included.
