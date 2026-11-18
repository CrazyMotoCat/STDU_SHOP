# WB-LAB-01 E4a acceptance and historical retries

**E4A_RUNTIME_PASS / ACCEPTED.** Run da496b6c17c1458d86e9d4c299526c95 started on 2026-11-14 at 18:33:14 +10:00 (volume creation) at HEAD 17976ff576661756d8a3354873dbd7cfc8db6854. Total 9.663 s. SHA-256 70c755b6e2e83d8bdecb69f0e1541e17b0f4b2bf8d77289f18ce868c1f23cc13. E3 remains accepted.

| Check                                    | Observed                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| IPv4 TCP and UDP positive controls       | Both independently received on loopback                                                                                                           |
| IPv4/IPv6 TCP and UDP negatives, UDP DNS | Five ENETUNREACH results, sent=false                                                                                                              |
| Namespace topology                       | Only lo, no IPv4 or non-loopback IPv6 routes, 22 mounts, RO /media, asound_mask_observed=true                                                     |
| Mask policy                              | runc, network none, identical pre-start and pre-cleanup policy, 12 MaskedPaths including /proc/asound, plus a separate list of five ReadonlyPaths |
| cgroup v2                                | 67108864 bytes memory, zero swap, cpu.max 25000 100000, 16 PIDs                                                                                   |
| Exit and cleanup                         | Exit 0, OOMKilled=false, watchdog 0, exact container and volume absent, inventory 0/0/3 unchanged, retained hashes verified                       |

The historical three failures remain below. The successful run establishes masking for its own container. The earlier mount attribution remains unproven. The evidence establishes isolation for this network-none profile. It provides no host packet capture or attached-network result.

**E5 = NOT_RUN. VDS_EQUIVALENCE = NOT_PROVEN. PHYSICAL_POWER_LOSS_DURABILITY = NOT_PROVEN.**

## Historical evidence

The retained E3 run is `117941e7f5a74f99ab27087493bc0dfa`, SHA-256 `b6f0bdc6c7abd86f77ca7ef97820a90daa5b470a4cb1cd6cd844ace7be7f3e2d`. The E4a failed run is `bc51510604f541218d3a12671468d327`, SHA-256 `80be049dc6a2148a43735af3b2f1b48ba9f58a65eb1389b08d37ae4149315a24`. Both original files stay in their existing directories together with E0b/E1/E2.

**ROOT_CAUSE_NOT_PROVEN** for that E4a attempt. The saved trace records a nonzero result from `docker start --attach` after 7475 ms within its 12000 ms budget. It contains neither CLI return code, attached stdout/stderr, container State/ExitCode/OOMKilled/Error nor a Python exception. No watchdog failure is recorded. Cleanup and resource absence are confirmed. A start failure and a nonzero probe exit remain distinguishable hypotheses. The RW mount was a verified configuration defect, but its causal role in the original exit is unproven.

The subsequent E4a-only retry on `06af094750f6a3c77da7acd09325a1e84d1dcdff` stopped with `UNEXPECTED_MOUNT` during namespace inspection (probe exit 73). Its run ID is `6ba94701ce914d939e150995b3397b96` and evidence SHA-256 is `9006427c320fe771ed5c4b6fb1c3d4fcdca51c9c3abe473a20992396f90935ff`. Cleanup was confirmed. The inventory and prior evidence were preserved. The eight canaries did not execute. The evidence identifies the failing check, but does not identify the unexpected mount or prove its origin.

## Mount diagnostics

The probe uses one bounded read of its own mountinfo to check the exact allowlist and `/media` access. If an unknown mount appears, the report records total and unknown mount counts and up to four unknown namespace destinations. Each row includes the losslessly percent-encoded destination, filesystem type, RO/RW access, observed `nosuid`, `nodev` and `noexec` flags, and whether the mount root was `/`. Decode percent escapes once to recover the destination bytes. Mount sources, root paths, raw mountinfo and arbitrary options are omitted.

The snapshot limit is 64 KiB and 256 rows. Each encoded destination is limited to 384 characters and filesystem type to 48. A limit hit blocks the probe. `truncated: true` marks omitted rows or an input that could not be fully read within budget. Counts are null when the full snapshot could not be inspected. The host validates the bounded schema before writing the report into evidence.

The allowlist is unchanged. Unknown mounts stop execution before canaries. The next authorized run can identify the namespace destination and metadata that triggered the rejection. A destination name or filesystem type alone does not establish provenance. Before proposing any exception, compare these observations with the owned container's validated Docker mount configuration and the expected engine/kernel mounts. If provenance is unproven, keep the profile blocked.

## Conditional ALSA directory mask

The third WB attempt at 1d9553e2d136ccb0280e01778695110650a9b1eb stopped before canaries after 9.823 s. Run 1868a7f417f04796a63e14321e17e100 returned exit 73 and cleanup CONFIRMED. Its SHA-256 is 97a75068c46bb66709e6fec94b2f793528d5d976c0c56b24fad7e76cc7a0e151. The only unknown mount of 22 was /proc/asound, a read-only tmpfs rooted at /. The report was complete. The original exact allowlist did not cover this directory mask.

WB reported Docker Engine 29.9.2 (build 0367cbe), containerd v2.4.2 and runc 1.5.2. The host has /proc/asound. The exact Engine source revision was unavailable. [Moby v28.5.2](https://github.com/moby/moby/blob/v28.5.2/oci/defaults.go#L188) is a pinned reference for its default mask list. It includes /proc/asound, /proc/acpi, /proc/interrupts, /proc/kcore, /proc/keys, /proc/latency_stats, /proc/timer_list, /proc/timer_stats, /proc/sched_debug, /proc/scsi, /sys/firmware, /sys/devices/virtual/powercap and present CPU thermal-throttle paths. [The OCI spec builder](https://github.com/moby/moby/blob/v28.5.2/daemon/oci_linux.go#L971) maps configured HostConfig MaskedPaths and ReadonlyPaths into the separate OCI Linux fields. [runc 1.5.2](https://github.com/opencontainers/runc/blob/v1.5.2/libcontainer/rootfs_linux.go#L1250) skips absent paths and masks existing directories with RO tmpfs. The third run's actual MaskedPaths were not retained. Historical origin remains MASK_ORIGIN_NOT_PROVEN.

The exception requires runc, network none, one owned RO media volume, no additional bind/volume/tmpfs declarations, /proc/asound in MaskedPaths and the expected ReadonlyPaths. The runner records bounded policy summaries and list digests before starting and before removal. It requires the two policy observations to match. Missing or ambiguous policy blocks. The namespace check accepts one /proc/asound only with that attestation and exact tmpfs type and source, mount root /, and exclusively RO mount and superblock access. Other unknown mounts still block. The topology result records whether the exception was actually observed.

Local Docker confirmed the effective inspect policy, a real RO runc directory mask, eight canaries, cgroup limits and cleanup. The local kernel has no ALSA proc directory. Fixtures cover exact /proc/asound acceptance and rejection of wrong type, root or access. Physical PASS requires all eight canaries, stable policy, actual RO media, confirmed cleanup and preserved inventory. The three failed E4a records are hash-pinned alongside accepted E0b–E3 evidence.

## Corrected profile and diagnostics

E1 retains its writable media mount. E4a creates `--mount type=volume,...,target=/media,volume-nocopy,readonly` and validates the actual inspect response before start. A writable E4a mount blocks. The probe also checks `ro` in `/proc/self/mountinfo`.

The bounded profile remains 64 MiB memory, zero additional swap, 0.25 CPU, 16 PIDs, network none and private namespaces. Workload deadline is 30 s, start command budget is 12 s and cleanup deadline is 10 s. Safe diagnostics record numeric CLI return code, output lengths and stderr SHA-256, a limited probe stage/error code, actual container status, ExitCode, OOMKilled and the presence/hash of Engine Error. Raw error strings and arbitrary output are omitted. The top-level probe converts exceptions to a fixed-code failure report and exits nonzero. Watchdog exit and timeout remain separate diagnostic categories. Failure to observe state marks BLOCKED while cleanup still attempts to remove the authenticated writer and volume.

## Historical one-shot execution gate

```sh
python3 -B experiments/wb-lab-01/runtime_e4a.py OWNER_E4A_ONLY_RUNTIME_APPROVED
```

The command records the prior approved entry point. The accepted run is complete. The runner obtains the lab root lock and checks host metadata and watermarks. The retained evidence bytes are read through bounded nofollow descriptors, hash-checked and parsed from the same bytes. It verifies prior cleanup and absence of prior container IDs, names and volumes. A new run ID and evidence directory are created. The retired combined entry point returns `COMBINED_E3_E4A_RETIRED`. E4a-only never invokes E3 or provisions PostgreSQL.

The successful retry requires all eight existing canaries, actual RO mount, confirmed stop/cleanup and preserved inventory. All three historical E4a failure records are hash-pinned along with accepted E0b–E3 evidence. A retry directory prevents another invocation. Any uncertain condition produces BLOCKED and retained evidence.

## Verification and evidence limits

Local tests cover the RW rejection, unchanged E1 behavior, authenticated-history replacement race, residue rejection, partial Docker create reconciliation and failure classification without leaking arbitrary error text. The opt-in local Docker fixture uses a new named volume with an actual RO mount, checks inspect and namespace observations, and confirms exact cleanup. An RW fixture is rejected while still in created state. The eight RO canaries passed on local x86-64 Docker. A separate fixture injected a real unexpected RW tmpfs and verified the bounded failure report before canaries. This is preparatory evidence for the upcoming ARM64/WB run.

```sh
WB_E4A_REAL_DOCKER=1 python3 -B -m unittest discover -s experiments/wb-lab-01 -p test_e4a_fix.py
```

The fixture uses the pinned amd64 Python image in `test_e4a_fix.py`. It needs Docker through the local Unix socket. Host packet capture, dedicated service canaries, E5 and VDS equivalence retain their existing NOT_PROVEN/NOT_RUN status.
