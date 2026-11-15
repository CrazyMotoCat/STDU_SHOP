# WB-LAB-01 checkpoint

TASK E5A-SLICE-01
STATUS E5A_RUNNER_INCOMPLETE
BRANCH codex/wb-lab-01, Draft PR #54
BASELINE 17976ff576661756d8a3354873dbd7cfc8db6854

E4A_RUNTIME_PASS accepted. WB run da496b6c17c1458d86e9d4c299526c95 on 2026-11-14 at the baseline HEAD, 9.663 s, 8/8 canaries and cleanup CONFIRMED. Evidence SHA-256 70c755b6e2e83d8bdecb69f0e1541e17b0f4b2bf8d77289f18ce868c1f23cc13. All three historical failures remain retained.

E5 = NOT_RUN. VDS_EQUIVALENCE = NOT_PROVEN. PHYSICAL_POWER_LOSS_DURABILITY = NOT_PROVEN.

The plan is experiments/wb-lab-01/RUNTIME-E5.md. OWNER_E5A_RUNNER_PREPARATION_APPROVED was received. The offline orchestration model, cgroup reader, exclusive evidence publisher and SQL commit reconciliation have local tests. Docker integration, independent supervision, socket provisioning and the two-session workload are pending. No runtime approval was issued. Codec image provisioning and worker/verifier workload require a distinct decision.

Independent Quality review of the previous slice was BLOCKED. The current offline slice adds exact-resource cleanup with a fake Engine, a forked watchdog tested against a fake backend, host sampling during simulated container startup, and rejection of arbitrary sample fields. A concrete Docker backend and persisted attested ledger, integrated crash recovery, socket/database identity, two-session SQL and complete evidence validation remain open. Latest local suite: 123 passed and 2 opt-in tests skipped. No new hosted CI.

Slice 01 implements the Unix-socket Engine backend for one create-only controller and an exclusive, fsynced intent. A separate pidfd watchdog recovers the exact container after simulated lost create acknowledgement and runner SIGKILL. It checks daemon, intent, labels, image and configuration before an exact-ID removal without volume deletion. Ambiguous cases retain the resource. The process suite uses a fake transport. The complete E5A runner and physical runtime remain pending.
