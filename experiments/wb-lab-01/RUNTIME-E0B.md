# WB-LAB-01 E0b — preparation, not executed

**Status: PREPARED / OWNER DECISION REQUIRED. E0b–E5 NOT_RUN.** E0a was accepted by the owner on `6637080541348b95623641464f4de1add07f0fb4`; it must not be repeated. This package adds no production schema, migrations, credentials, media API or decoder. It does not alter the accepted E0a runner.

## Dependencies and integration

| PR  | Role                                                         | Current relationship                                 |
| --- | ------------------------------------------------------------ | ---------------------------------------------------- |
| #52 | Owner-approved VIS-CAT-02C plan, still Draft                 | Design dependency; WB deviations remain explicit     |
| #53 | Mock intent/fencing/preflight model, still Draft             | Code base of #54, not a real PG/storage proof        |
| #54 | WB-specific preflight, accepted E0a and this E0b preparation | Draft against the #53 branch; no merge authorization |

Recommended later integration: independently approve/merge #52 documentation, then #53 mocks, retarget/synchronize #54 with current main, review the resulting diff and run required exact-head checks. No PR is merged by this task. The WB rootfs/eMMC is shared: volumes isolate names/paths, not device bandwidth, capacity, host root or a future VDS.

## Gate and exact resources

Only a future explicit **OWNER_E0B_RUNTIME_APPROVED** permits the agent to archive accepted E0a evidence and execute `runtime_e0b.py`. The argument is an operator-intent gate, not cryptographic authorization. Neither import, tests, CI nor the present owner task executes it. No commands are submitted to the WB for this stage beyond read-only image inspection.

One random 32-hex run ID names:

- One container `wb-lab-01-e0b-<id>`; exact Docker ID is saved before start.
- Two new local volumes `wb-lab-01-e0b-<id>-pg` and `...-media`; no external volumes, bind mounts or named network.
- One root-owned mode-0700 evidence directory beneath the approved laboratory root. No resource names from OPS-TEST-02 are accepted.

Every created object has `stdu.wb-lab-01.run=<id>`. The ledger persists create intent before invoking Docker, exact IDs, volume name/CreatedAt/Mountpoint and image ID. Volume sources must resolve without symlinks to the exact approved DockerRoot/volumes/name/_data, on the confirmed ext4 device. Only the just-created empty PG directory is chowned, by directory fd, to UID/GID 999; there is no recursive chown or deletion by host path. Source sentinels use exclusive no-follow writes and fsync.

Use the PostgreSQL digest already specified in this lab's Compose: `docker.io/library/postgres@sha256:d628bc2cef336ab1f527cd6e8de5f04827c069e5f24153b5e99d9bf64e5ff925`. Only explicit official Docker Hub aliases of this same digest are accepted, with inspected ARM64/Linux identity. `--pull=never` prevents acquisition during runtime. Read-only WB inspection confirmed this pinned image is absent locally; acquisition and ARM64/UID/tool compatibility remain entry prerequisites, not PASS. There is no mutable tag fallback.

## Workload and limits

One PostgreSQL container, no controller/worker/verifier containers. It runs as 999:999 with a read-only root, capabilities dropped, no-new-privileges, private IPC/cgroup namespaces and disabled Docker logs. `network=none`, no published ports and no TCP listener. SQL uses a Unix socket through exact-ID `docker exec`; no Docker socket is mounted. Local trust authentication exists only inside this disposable synthetic instance; it is not an authentication template for the application. Host Docker/root remains a trusted boundary.

| Bound                        | Prepared value / interpretation                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| PG memory / swap             | 192 MiB / no additional swap; verify actual cgroup values                                                                                    |
| CPU / PIDs                   | 0.50 CPU / 32                                                                                                                                |
| shared buffers / connections | 24 MiB / 6                                                                                                                                   |
| tmpfs / shared memory        | /tmp 8 MiB, socket 2 MiB, shm 16 MiB, charged to cgroup                                                                                      |
| Workload deadline            | 30 s including initialization, readiness and assertions                                                                                      |
| Docker budgets               | inspect/list 3 s, create/start/exec 5 s, clipped to remaining deadline; late success rejected                                                |
| Readiness                    | At most 32 pg_isready attempts, 0.5 s bounded pause under the unchanged global deadline; errors other than expected not-ready statuses block |
| Cleanup                      | Separate total 10 s; watchdog join at most 4 s                                                                                               |
| Host stop watermarks         | MemAvailable 768 MiB; free disk 4 GiB                                                                                                        |
| PG / media writes            | Watchdog watermarks 128 MiB / 1 MiB, sampled; not filesystem quotas                                                                          |
| Per-file writes              | PG shell file-size limit 64 MiB; not an aggregate quota                                                                                      |
| Evidence                     | Atomic fsync writes, at most 16 KiB each; bounded operations list                                                                            |

The independent host watchdog checks headroom, OOM/container state, exact ownership and volume identity, and bounded `du` of only the owned volume paths. A stop condition removes only the validated container ID and confirms absence. Thresholds can be overshot between observations: this is not a hard disk-capacity guarantee or ENOSPC test. Cold initdb under these provisional limits may fail the 30-second gate; do not extend budgets or claim ARM64 performance without measurements. Host supervisory overhead is not cgroup-enforced by this container limit and remains to be measured against the 512 MiB campaign budget.

## Assertions and evidence

Initialization creates only a disposable cluster, `wb_lab_<id>` database, `e0b` schema, one sentinel table/row and a restricted `wb_probe` login role. No application migration runs. Record database name, control-system identifier and data directory; require exact database identity. The probe role has no superuser/createDB/createRole/replication/bypassRLS flags. It reads back the exact run nonce through SQL. Two distinct volume sentinels must retain their hashes after PG startup and SQL. `fsync` stays enabled, but this stage does not prove crash durability.

Runtime PASS requires readiness, identity/role/sentinel assertions, actual cgroup limits, a live watchdog, no OOM, writer cleanup, both owned volumes confirmed absent, and all previous container IDs/volume names/network IDs still present. Inventory existence is not a claim of immutable foreign contents. Unknown ownership or cleanup means BLOCKED/CLEANUP_UNCONFIRMED and no volume removal past that boundary.

Machine-readable evidence records fixed operation names, elapsed time, assigned budgets and error types. It excludes arbitrary stdout/stderr, secrets and host inventory lists. Only synthetic sentinels are used. Raw evidence stays on WB and in ignored local storage; publish a reviewed summary, not raw host output.

## Evidence preservation and future execution sequence

After separate authorization, the agent must first preserve the accepted E0a run using the prepared `archive_e0a_pass.py` with the E0b approval argument. It verifies the exact known SHA-256, successful state, owned identities, daemon and absent Docker resources, then moves only that run directory to the existing root-owned 0700 sibling archive on the same filesystem and fsyncs both directories. Unexpected SGID, symlinks, existing destination or extra files block archival; no automatic chmod of pre-existing directories. Do not archive during this preparation task.

Then verify the reviewed Git revision and pinned local image, run fresh host preflight on the empty lab root and execute only E0b. Preserve the final JSON even on failure, independently recheck owned object absence, retrieve a hash-matching local copy and stop. A retry requires explicit analysis of the retained evidence; the runner refuses a nonempty root. No E1–E5, real power loss, ENOSPC, reboot, host firewall or system setting changes.

## Acceptance matrix

| Property                                                           | Offline check       | WB status          |
| ------------------------------------------------------------------ | ------------------- | ------------------ |
| Wrong/missing approval cannot reach provisioning                   | Unit test           | NOT_RUN            |
| Exact image digest and ARM64 aliases; foreign references rejected  | Unit test           | NOT_PROVEN locally |
| Readiness failure / CLI failure / deadline                         | Fake CLI tests      | NOT_RUN            |
| DB identity and SQL sentinel, restricted role                      | Fake SQL tests      | NOT_RUN            |
| Volume ownership/source/device/symlink safety                      | Unit/negative tests | NOT_RUN            |
| Partial create, interrupt, uncertain cleanup, foreign preservation | Lifecycle tests     | NOT_RUN            |
| Actual PG memory/CPU/PIDs, cold initdb latency, disk use           | Prepared assertions | NOT_RUN            |
| Crash/recovery, lease fencing, connected-network canaries          | Separate E1–E5      | NOT_RUN            |
| VDS equivalence and production durability                          | Outside WB evidence | NOT_PROVEN         |

Next owner decision: approve this exact prepared revision for a single bounded E0b campaign, including the scoped archival and any separately documented pinned-image acquisition. Until then: **E0A_CLOSED / E0B_READY_FOR_OWNER_DECISION**, not E0B_RUNTIME_PASS.
