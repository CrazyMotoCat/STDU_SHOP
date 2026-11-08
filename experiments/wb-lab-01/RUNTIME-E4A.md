# WB-LAB-01 E4a-only retry preparation

**E4A_FIX_READY_FOR_OWNER_RUNTIME_DECISION.** The next physical run requires `OWNER_E4A_ONLY_RUNTIME_APPROVED` on the reviewed HEAD. E3 is accepted. Its ten scenarios created nine correct references, with cleanup CONFIRMED and preserved foreign inventory.

## Historical evidence

The retained E3 run is `117941e7f5a74f99ab27087493bc0dfa`, SHA-256 `b6f0bdc6c7abd86f77ca7ef97820a90daa5b470a4cb1cd6cd844ace7be7f3e2d`. The E4a failed run is `bc51510604f541218d3a12671468d327`, SHA-256 `80be049dc6a2148a43735af3b2f1b48ba9f58a65eb1389b08d37ae4149315a24`. Both original files stay in their existing directories together with E0b/E1/E2.

**ROOT_CAUSE_NOT_PROVEN** for that E4a attempt. The saved trace records a nonzero result from `docker start --attach` after 7475 ms within its 12000 ms budget. It contains neither CLI return code, attached stdout/stderr, container State/ExitCode/OOMKilled/Error nor a Python exception. No watchdog failure is recorded. Cleanup and resource absence are confirmed. A start failure and a nonzero probe exit remain distinguishable hypotheses. The RW mount was a verified configuration defect, but its causal role in the original exit is unproven.

## Corrected profile and diagnostics

E1 retains its writable media mount. E4a creates `--mount type=volume,...,target=/media,volume-nocopy,readonly` and validates the actual inspect response before start. A writable E4a mount blocks. The probe also checks `ro` in `/proc/self/mountinfo`.

The bounded profile remains 64 MiB memory, zero additional swap, 0.25 CPU, 16 PIDs, network none and private namespaces. Workload deadline is 30 s, start command budget is 12 s and cleanup deadline is 10 s. Safe diagnostics record numeric CLI return code, output lengths and stderr SHA-256, a limited probe stage/error code, actual container status, ExitCode, OOMKilled and the presence/hash of Engine Error. Raw error strings and arbitrary output are omitted. The top-level probe converts exceptions to a fixed-code failure report and exits nonzero. Watchdog exit and timeout remain separate diagnostic categories. Failure to observe state marks BLOCKED while cleanup still attempts to remove the authenticated writer and volume.

## One-shot execution gate

```sh
python3 -B experiments/wb-lab-01/runtime_e4a.py OWNER_E4A_ONLY_RUNTIME_APPROVED
```

The agent verifies the checkout and staged hashes, uses the pinned existing Python image and executes the above command only after owner approval. The runner obtains the lab root lock and checks host metadata and watermarks. The retained evidence bytes are read through bounded nofollow descriptors, hash-checked and parsed from the same bytes. It verifies prior cleanup and absence of prior container IDs, names and volumes. A new run ID and evidence directory are created. The retired combined entry point returns `COMBINED_E3_E4A_RETIRED`. E4a-only never invokes E3 or provisions PostgreSQL.

The successful retry requires all eight existing canaries, actual RO mount, confirmed stop/cleanup and preserved inventory. The original failed evidence stays unchanged. A retry directory prevents another invocation. Any uncertain condition produces BLOCKED and retained evidence.

## Verification and evidence limits

Local tests cover the RW rejection, unchanged E1 behavior, authenticated-history replacement race, residue rejection, partial Docker create reconciliation and failure classification without leaking arbitrary error text. The opt-in local Docker fixture uses a new named volume with an actual RO mount, checks inspect and namespace observations, and confirms exact cleanup. An RW fixture is rejected while still in created state. The eight RO canaries passed on local x86-64 Docker. This is preparatory evidence for the upcoming ARM64/WB run.

```sh
WB_E4A_REAL_DOCKER=1 python3 -B -m unittest discover -s experiments/wb-lab-01 -p test_e4a_fix.py
```

The fixture uses the pinned amd64 Python image in `test_e4a_fix.py`. It needs Docker through the local Unix socket. Host packet capture, dedicated service canaries, E5 and VDS equivalence retain their existing NOT_PROVEN/NOT_RUN status.
