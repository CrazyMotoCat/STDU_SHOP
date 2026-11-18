# WB-LAB-01 E0a runtime resource verification

Status **E0A_CLOSED / OWNER ACCEPTED**. Runtime revision `6637080541348b95623641464f4de1add07f0fb4` produced `E0A_RUNTIME_PASS`, independently reviewed Quality PASS and exact-head [FAST SUCCESS](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/42037881238) / [FULL SUCCESS](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/42037881255). The owner accepted this laboratory stage. Do not repeat it. PR #54 remains Draft, with no merge authorization. E0b–E5 remain NOT_RUN.

| Host check                                                      | Owner evidence                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Engine, Compose and platform                                    | PASS. Engine 29.9.2, Compose 5.6.1, ARM64                                         |
| Kernel and daemon identity                                      | PASS. WB kernel and approved local daemon matched                                 |
| Resource capability                                             | PASS. cgroup v2/systemd and Engine resource capability flags                      |
| Filesystem and headroom                                         | PASS. Shared ext4 on eMMC, with RAM and disk above the preflight watermarks       |
| Lab directory                                                   | PASS. Root-owned, mode 0700 and empty at observation                              |
| Actual container limits, runtime resource ownership and cleanup | PASS: independently observed limits; exact resource identities; cleanup CONFIRMED |
| VDS equivalence and connected-network policy                    | NOT_PROVEN                                                                        |
| E0b through E5                                                  | NOT_RUN                                                                           |

## Exact experiment

One fresh random run ID identifies one Docker local volume and one container, both named `wb-lab-01-e0a-<run-id>` with the exact run label. Network mode none uses Docker's existing isolated mode and creates no network object. The probe runs the pinned local ARM64 Python image as UID 65532 with a read-only root and read-only, no-copy mount. The probe needs no database, decoder, credentials, package download or published port. Container logs are disabled. The only host writes are Docker's own metadata and the ledger/result inside one private run directory.

The host gate checks the known daemon ID, versions, local ext4 and an empty lab root. An exclusive lock on that directory serializes launches. The runner snapshots existing container IDs, volume names and network IDs. It records create intent before invoking Docker and checks the exact response and the inspect identity before start. For the local volume, its exact name, creation time and mountpoint form the recorded identity. The resolved source must be beneath the approved Docker root at the exact per-run volume location and on the same ext4 device. The probe verifies the mounted device and read-only flag from inside the container.

| Runtime assertion | Expected value                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| memory.max        | 67108864                                                                                                                        |
| memory.swap.max   | 0                                                                                                                               |
| cpu.max           | 25000 100000                                                                                                                    |
| pids.max          | 16                                                                                                                              |
| Networking        | Docker none, only loopback inside, no port mappings                                                                             |
| Probe identity    | Exact inspected ID, local image ID, owner label, UID and mount identity                                                         |
| Final state       | Normal exit with zero status and no OOM, container and volume absent after scoped cleanup, pre-existing inventory still present |

The workload shares 30 seconds, Docker inspect/list/remove receive at most 3 seconds, create at most 5 seconds and start/attach at most 12 seconds, each clipped to the remaining workload deadline, and the probe has an internal 8-second alarm. An independent process observes host watermarks and the owned container during execution and signals failure by exit code. On a stop condition it removes only the exact inspected owned container, including a container still in created state, and checks that the ID is absent. Thresholds are MemAvailable at least 768 MiB and at least 4 GiB free. Ownership, OOM, unknown state, timeout or resource observation failure blocks PASS. The runner gives cleanup a separate 10-second deadline, joins the watchdog, removes the exact owned container, confirms absence, then removes the owned volume after checking identity and absence of attachments. A forced operator interruption uses Ctrl-C and the same cleanup path. If removal or create outcome cannot be confirmed, leave the evidence and reconcile manually by exact identity. A hard kill of the supervising host process can leave owned resources for manual reconciliation.

Evidence is JSON in the mode-0700 run directory, at most 16 KiB per atomic write. It includes status, reason codes, run label/identity, image ID, mount/device evidence, observed cgroup values and cleanup/inventory result. It excludes raw Docker inspect, credentials, paths outside the owned mount metadata and raw command logs. Do not upload the local evidence until it has been reviewed and redacted. Inventory preservation verifies existence of prior resources, with no claim about external changes to their contents or state.

## Accepted execution evidence

Run `23ceb807c68f4ae0bed724def6e58d68` confirmed memory.max=67108864, memory.swap.max=0, cpu.max=25000 100000 and pids.max=16. The container ran as UID 65532 with only loopback, no published ports and a read-only volume on the expected device. Container start/attach took **4506 ms**, creation 199 ms and volume creation 84 ms. Cleanup was CONFIRMED and a separate read-only check confirmed the owned container and volume absent. Foreign inventory preservation proves continued existence of prior IDs/names, not unchanged contents or attributes.

Private evidence is retained at `/mnt/data/stdu-wb-lab-01/23ceb807c68f4ae0bed724def6e58d68/evidence.json`; SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`. A byte-identical copy is retained in ignored local storage. Historical failed attempts are preserved separately. Raw host JSON is not published. Future E0b preparation includes a separate gated archive procedure; it has not been run.

The prior TimeoutExpired is strongly associated with start/attach by historical Docker events; its old evidence cannot prove exact successful completion time. This new observation exceeds the old 3-second cap. Per-operation diagnostics and bounded budgets are now implemented. The `failure_operation` field on this successful run contains an expected initial inspect/not-found result, not an actual workload failure; this diagnostic ambiguity does not invalidate the measured assertions.

E0a proves this bounded none-network probe on WB, not PostgreSQL readiness, connected-network enforcement, crash durability, storage recovery or VDS equivalence. No E0b–E5 workload ran.

## Historical execution procedure — do not rerun accepted E0a

Use the owner-approved WB console and the reviewed Git revision. Ensure the pinned ARM64 image is already available locally. If it is absent, the probe stops before creating Docker resources. Image acquisition is a separate controlled action. The laboratory root must be empty for this one-shot run. A retained evidence directory requires operator review before any repeat.

After explicit `OWNER E0A_RUNTIME_APPROVED` and Quality PASS, run this one command from the checkout root on WB:

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY \\
  python3 -B experiments/wb-lab-01/runtime_e0a.py OWNER_E0A_RUNTIME_APPROVED
```

The final JSON has been retained and reviewed; no new run is needed. E0a Runtime PASS requires every assertion and confirmed cleanup. E0b–E5 have separate entry gates and remain outside this command.
