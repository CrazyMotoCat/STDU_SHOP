# E5A physical failure investigation

Campaign `abf207d097b74e7f8d4a1622b49693db` ran at `dfa12619d915b017e22bec8301b88e7b5af9c4c2` on 2026-11-23. Physical verdict: `E5A_PHYSICAL_RUNTIME_BLOCKED`. Original evidence SHA-256: `77f02923fc687e6891879bb8fa5a037f2401bb6234d8bd07ab25c47c0e2ed5ab`. The private investigation manifest pins the original bytes, watchdog journals, run ledger, scoped Engine events, preflight and later read-only verification. The original evidence is unchanged.

## Event timeline

The Docker column uses daemon wall time (UTC). The sampling column uses the host monotonic clock. The historical records have no shared clock anchor that would order individual requests and samples across those columns.

| Operation                     | Configured deadline in the original revision                                 | Recorded result                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline and inventory        | Baseline 5 s, sample target 250 ms, watchdog tick 240 ms                     | Baseline complete. Monotonic 320400–324907 ms, 19 accepted rows, intervals 246–255 ms.                                                                               |
| Create and mount media volume | At most 5 s per Engine request, clipped to phase                             | Docker create 02:31:54.615082 and mount 02:31:55.132083. Request start and response times unrecorded.                                                                |
| Create controller             | At most 5 s, clipped to phase                                                | Docker create 02:31:54.994369. Full ID was saved in the ledger. Request start and response times unrecorded.                                                         |
| Start controller              | At most 5 s, clipped to phase                                                | Docker start 02:31:55.717775. The start event establishes the state change. The API response remains unobserved.                                                     |
| Engine attest and inspect     | At most 5 s, clipped to the remaining tick or phase                          | Specific begin/end times absent. The original watchdog's sampling path could issue daemon-info, container and volume requests within one 240 ms budget.              |
| Docker stats                  | No call in the runtime                                                       | No stats request was issued by the harness. Live metrics come from procfs, cgroup v2 and statvfs.                                                                    |
| Controller sampling           | 250 ms target, 500 ms freshness, parent polling budget 450 ms                | Two accepted rows at monotonic 325446 and 325691 ms, both without attested container counters. No CPU, RAM, PID or I/O workload sample was accepted.                 |
| Heartbeat and transport       | Heartbeat limit 3 s, original curl child capped at 5 s or remaining deadline | The sealed runner recorded `E5A_SAMPLE_MISSING`. The watchdog journal recorded `TimeoutExpired`. No per-call elapsed time, route, budget or heartbeat age was saved. |
| Controller cleanup            | At most 10 s, shared by stop/removal and verification                        | Docker kill 02:31:55.889082 and 02:31:56.942919, stop 02:31:57.051028, die 02:31:57.058049 and destroy 02:31:57.211741.                                              |
| Media cleanup                 | Same 10 s cleanup window                                                     | Docker unmount 02:31:57.050875 and volume destroy 02:31:57.465248.                                                                                                   |
| PostgreSQL and recovery tail  | 30 s workload plus 10 s cleanup, then 5 s recovery                           | `NOT_RUN`. The recovery tail is separate from watchdog cleanup.                                                                                                      |

The watchdog encountered an Engine transport timeout during the controller phase. The exact call is `ROOT_CAUSE_NOT_PROVEN`. Daemon contention during container startup and cumulative per-tick I/O are plausible explanations. The records cannot distinguish daemon-info, inspect, volume lookups, or another call on that path. Resource exhaustion was not observed in the accepted host samples. Missing container samples prevent a conclusion about workload resource use.

## Cleanup evidence

The immutable sealed runner status is `CLEANUP_UNCONFIRMED`. The separate watchdog completion journal reports `CONFIRMED`. Scoped Docker events and the later inventory independently corroborate container and volume absence. Preflight stored inventory counts and a digest. The later snapshot reproduced that digest with zero containers, zero volumes and three unchanged network IDs. Docker, SSH, nginx and Mosquitto recorded the same state, process identity and service start time. These observations do not change the acceptance verdict.

## Offline remediation

Engine requests use HTTP over the local Unix socket. Connect, write and each buffered read use the remaining absolute deadline. The timeout record contains only a fixed operation code, exchange stage, elapsed time and budget. A late complete response is rejected. No Docker transport subprocess is left behind when the runner or worker dies. The watchdog observes runner liveness independently with a pidfd, avoids shared semaphores on the liveness path, and stops identity-verified provisioning workers before recovery. A broken or unavailable daemon can prevent resource confirmation, in which case the campaign remains blocked and cleanup remains unconfirmed.

The first runner failure, watchdog abort and subsequent cleanup report retain separate meanings. The runner can reconcile cleanup only after the watchdog exits normally with a matching durable completion record and a fresh matching inventory from the attested daemon. A confirmed cleanup does not approve a failed workload. Timeout and recovery behavior are exercised with local Unix-socket fake peers and isolated Linux processes. No workload, resource, timing or PASS budget was increased.
