# WB-LAB-01 E0b sentinel permissions fix

**Status E0B_BLOCKED / E0B_REPEAT_NOT_APPROVED.** One authorized WB attempt on `36fb3cfc3ffb6831e7207415b2f277590ac494c2` ended in `E0B_DOCKER_COMMAND_FAILED`. Run `742071b6115e4a00a8b65cc7151f8c39`. E1–E5 remain NOT_RUN and VDS equivalence remains NOT_PROVEN.

PostgreSQL readiness passed on poll 8, about 12.573 s after Docker start. SQL verified the database identity, SQL sentinel and restricted `wb_probe` role. Exact cgroup comparisons passed for 192 MiB memory, zero swap, 0.5 CPU and 32 PID. Both host-side sentinel hashes passed. Watchdog completed without recording a stop condition. The runner finished in 21.176 s, including preflight and cleanup. Peak RAM, CPU use and disk writes were not measured.

Docker events confirmed that the in-container `sha256sum` exited 1 after 279 ms. The wrapper used `umask 077` to protect evidence. Linux applies that mask to the requested file mode `0444`, producing a root-owned `0400` sentinel that UID 999 cannot read. This is the leading explanation. The inode metadata and per-file stderr were not captured. The mounted-hash assertion, actual loopback check and final OOM check were not reached.

The fix sets and verifies mode `0444` on the exclusively opened sentinel descriptor before writing. File and directory fsync are preserved. This mode is for synthetic sentinel nonces only. The runtime now records `E0B_MOUNTED_SENTINEL_READ_FAILED` on a nonzero hash command exit, while hash mismatch retains its separate code. No raw Docker stdout/stderr is added to evidence.

Cleanup CONFIRMED by independent read-only inventory comparison. The exact container and both owned volumes were absent. Prior IDs and names were preserved. The matching WB/local evidence SHA-256 is `dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28`.

## Dependencies and integration

| PR  | Role                                                         | Current relationship                                 |
| --- | ------------------------------------------------------------ | ---------------------------------------------------- |
| #52 | Owner-approved VIS-CAT-02C plan, still Draft                 | Design dependency; WB deviations remain explicit     |
| #53 | Mock intent/fencing/preflight model, still Draft             | Code base of #54, not a real PG/storage proof        |
| #54 | WB-specific preflight, accepted E0a and this E0b preparation | Draft against the #53 branch; no merge authorization |

Recommended later integration: independently approve/merge #52 documentation, then #53 mocks, retarget/synchronize #54 with current main, review the resulting diff and run required exact-head checks. No PR is merged by this task. The WB rootfs/eMMC is shared: volumes isolate names/paths, not device bandwidth, capacity, host root or a future VDS.

## Gate and exact resources

The original owner approval covered one attempt and is consumed. A new explicit **OWNER_E0B_RUNTIME_APPROVED** on the reviewed fix HEAD is required for any WB repeat. The CLI argument records operator intent. Offline tests exercise the runner with fake Docker operations and synthetic local files.

One random 32-hex run ID names:

- One container `wb-lab-01-e0b-<id>`; exact Docker ID is saved before start.
- Two new local volumes `wb-lab-01-e0b-<id>-pg` and `...-media`; no external volumes, bind mounts or named network.
- One root-owned mode-0700 evidence directory beneath the approved laboratory root. No resource names from OPS-TEST-02 are accepted.

Every created object has `stdu.wb-lab-01.run=<id>`. The ledger persists create intent before invoking Docker, exact IDs, volume name/CreatedAt/Mountpoint and image ID. Volume sources must resolve without symlinks to the exact approved DockerRoot/volumes/name/_data, on the confirmed ext4 device. Only the just-created empty PG directory is chowned, by directory fd, to UID/GID 999; there is no recursive chown or deletion by host path. Source sentinels use exclusive no-follow writes and fsync.

Use the PostgreSQL digest already specified in this lab's Compose: `docker.io/library/postgres@sha256:d628bc2cef336ab1f527cd6e8de5f04827c069e5f24153b5e99d9bf64e5ff925`. Only explicit official Docker Hub aliases of this same digest are accepted, with inspected ARM64/Linux identity. `--pull=never` prevents acquisition during runtime. The previous authorized campaign obtained this image and verified its digest, ARM64 platform and volume declaration on WB. There is no mutable tag fallback. Before any create, image-declared Volumes must be exactly `/var/lib/postgresql`, which the runner explicitly mounts. Missing, child or extra declarations block provisioning, preventing Docker from allocating an anonymous volume outside the ledger.

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

## Evidence and retry gate

Accepted E0a evidence was moved to the private archive during the authorized E0b campaign. Its SHA-256 remains `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`. E0a stays closed.

The blocked E0b run retains its original evidence under the lab root. The runner requires an empty lab root. A future authorized retry must first reconcile and preserve the failed run by exact ledger, verified resource absence and matching hash. The fix task leaves the evidence in place. A retry also needs a fresh preflight and verification of the existing pinned image.

## Acceptance matrix

| Property                                                     | Offline check                                | WB result for the one approved run |
| ------------------------------------------------------------ | -------------------------------------------- | ---------------------------------- |
| Exact image digest, platform and volume declaration          | Negative metadata tests                      | PASS                               |
| Readiness, DB identity, SQL sentinel and restricted role     | Fake SQL and readiness tests                 | PASS                               |
| Volume ownership, source and device                          | Negative binding tests                       | PASS                               |
| Host sentinel hashes                                         | Local synthetic files                        | PASS                               |
| File mode with `umask 077`, readable by UID 999              | Isolated Linux subprocess, PG and media      | Fix pending WB retry               |
| Mounted sentinel hashes                                      | Simulated Docker failure and hash comparison | BLOCKED at hash command            |
| Actual PG cgroup limits                                      | Expected-value comparisons                   | PASS                               |
| Actual loopback and final OOM assertion                      | Prepared assertions                          | NOT_RUN                            |
| Watchdog and scoped cleanup                                  | Lifecycle and refusal tests                  | CONFIRMED                          |
| Crash recovery, lease fencing and connected-network canaries | Separate E1–E5                               | NOT_RUN                            |
| VDS equivalence and production durability                    | Outside WB evidence                          | NOT_PROVEN                         |

**E0B_FIX_READY_FOR_OWNER_RETRY_DECISION** is a code delivery status. Runtime remains BLOCKED pending separate authorization and a successful WB result.
