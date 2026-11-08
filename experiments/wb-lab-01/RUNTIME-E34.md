# WB-LAB-01 E3/E3b and E4a

**Historical combined cycle completed. E3_RUNTIME_PASS accepted, E4a BLOCKED.** The combined entry point is retired. The next gate and current command are in [RUNTIME-E4A.md](RUNTIME-E4A.md).

Historical instructions follow. One cycle requires `OWNER_E3_E4A_RUNTIME_APPROVED` on the reviewed commit. The agent verifies the checkout and pinned E0b/E1/E2 evidence hashes on WB, then runs from the repository root with `umask 077`.

```sh
# Retired command. Use the E4a-only runbook.
```

The runner locks the lab directory, runs host preflight and authenticates the existing local ARM64 images. E4a starts only after E3 PASS, confirmed cleanup and fresh preflight. Each phase has a 30 s workload deadline and 10 s cleanup budget. E3 uses PostgreSQL (192 MiB, 0.5 CPU, 32 PIDs) and a controller (64 MiB, 0.25 CPU, 16 PIDs). E4a uses only the controller. Additional swap is zero. Watchdogs check host watermarks, owned containers and, during E3, volume write watermarks. A new evidence directory prevents another invocation.

| E3/E3b cases                                       | Acceptance                                                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kill after partial write, stage sync and promotion | A pipe barrier identifies the boundary. The exact forked child exits by SIGKILL. Stage bytes and final presence are verified before recovery. An already promoted inode survives replay. |
| Inject EIO at write, fsync and promotion           | The designated injection fires. Recovery publishes the expected digest exactly once.                                                                                                     |
| Existing foreign final                             | No-replace promotion returns EEXIST. Original inode and bytes survive. No reference is inserted.                                                                                         |
| Client disconnect                                  | A fresh connection commits once and replays.                                                                                                                                             |
| Terminate an owned PostgreSQL backend              | The synthetic session is authenticated by PID, DB, user and application name. Its uncommitted reference rolls back. Recovery commits once.                                               |
| Lose the COMMIT response                           | An observer sees the committed reference. A fresh client replays twice without reapplying it.                                                                                            |

Intents commit before the writer starts. The controller has no DB socket or credentials. The host verifies device, inode, size and digest before inserting references. SQL checks run after each case and require nine valid references and none for the collision. The foreign canary remains present throughout. Before removing the volumes, cleanup confirms writer removal, authenticates the media volume and checks its bounded directory tree. Unknown objects retain the volume for investigation. These are synthetic process/transaction faults. Service-wide outage, power-loss durability, paused-writer generation takeover and selective orphan deletion are NOT_PROVEN for this slice. E2 separately covered SQL generation fencing.

E4a uses `network=none` with no published ports, private PID/cgroup namespaces, dropped capabilities and one empty owned media mount. The original E4a attempt used RW despite this runbook previously describing RO. The corrected E4a-only profile requires read-only. Inspect and the actual mountpoint allowlist must agree. Eight checks cover TCP/UDP loopback positives observed by a separate receiver process, IPv4/IPv6 TCP and UDP negatives, one DNS datagram to a documentation address, and namespace/routes/mounts. Negative probes require explicit local denial. A timeout, connection refusal or successful UDP send blocks the stage. Host packet capture and service-specific host/PostgreSQL/verifier canaries remain NOT_PROVEN.

Evidence includes per-case latency, controller RSS, cgroup memory peak, CPU and I/O, PostgreSQL cgroup counters, exact ownership ledger and cleanup. Missing counters are explicit. Peak RSS for individual PostgreSQL processes is outside this measurement. The E4a-only retry remains NOT_RUN on WB and E5 is a separate phase.

```sh
python3 -B -m unittest discover -s experiments/wb-lab-01
WB_E2_REAL_PG=1 WB_E34_REAL_PG=1 python3 -B -m unittest discover -s experiments/wb-lab-01 -p test_e2.py -k E2Postgres
```

The optional integration uses the pinned local amd64 PostgreSQL image from `test_e2.py`. The local E4a smoke used a disposable x86-64 network-none container and empty read-only tmpfs. WB ext4/ARM64 timings are still unmeasured.
