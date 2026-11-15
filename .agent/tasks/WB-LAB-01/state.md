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

Slice 01 is published on Draft PR #54 at 91925421e3ff428eda5756c132f450cdf4b78fd8, based on dab6cbad0756f8af76b4e9b51c60a2d6d81b79b3. FAST 43681132756 and FULL 43681132809, including the merge gate, succeeded.

Slice 02 remains BLOCKED. Local SQL and identity helpers cover directory and socket inode checks, a transaction-local database marker, a simulated two-session row lock, and read-only reconciliation mapped from psql exit 2. Quality found that PostgreSQL provisioning, the persisted mount ledger and crash cleanup are missing and that socket replacement during connect remains unproven. No Slice 02 push or physical run.

The blocker-closure attempt added the Engine-backed PostgreSQL intent, resource records and address-specific recovery. A fake Engine and separate pidfd watchdog exercise SIGKILL after provisioning, lost create/start responses, PostgreSQL crash state, rejection of foreign attachments/changed mounts/daemon/ledger, and resumed recovery after abrupt watchdog exit. These tests do not open a SQL session. Quality remains BLOCKED on database bootstrap, production of a verified data volume with its watermark, joint controller cleanup, and connected peer attestation. The public SQL query helper now blocks explicitly before connecting; direct libpq with verification of the actual connected socket is the proposed next implementation.

Final-blocker iteration added direct libpq peer attestation, Docker PID/start-time derivation, a run-specific bootstrap and readiness helper, and a bounded apparent-size data sampler checked before SQL. The process suite now kills the runner inside the fake first transaction callback and verifies no next workload. Independent Quality remains BLOCKED. Periodic watermark-driven cleanup and combined controller/PostgreSQL/socket recovery are not wired, and real libpq/PostgreSQL readiness is unverified. Latest WSL target suite: 26 PASS. No new commit, push or hosted CI.

Offline completion continuation verified the direct libpq path with PostgreSQL 18.6 in an isolated, non-Docker WSL cluster (UID 999, Unix socket only). Three rows committed, the third acknowledgment was discarded after COMMIT and verified by a fresh read-only session, row-lock timeout measured 1,000,427 us, and statement timeout completed in about 2.503 s. A wrong process start time blocked access. The exact local PostgreSQL process was stopped and its postmaster PID file cleared. This experiment did not attest the pinned ARM64 container, its bind mount or its cgroup.

The paired SQL supervisor independently samples the 128 MiB apparent-size watermark during the session. Process tests exercise runner SIGKILL, the watermark, a missing sample, a foreign attachment, exact residual socket cleanup and replacement watchdog recovery on a fake Engine. Its controller is create-only. Remaining blockers are the running controller and owned media volume in the paired phase, integration of the supervisor into the full campaign, and strict final evidence. Latest independent Quality verdict is BLOCKED. No new hosted CI or physical execution.

Regression suite split by local tooling: WSL 121 passed and 2 opt-in skipped, Windows Compose profile 12 passed. The E1 rejection test now mocks its process-wide resource limit so it does not alter subsequent watermark tests. Ruff, Prettier and diff checks passed. Docker Desktop is a shared x86_64 desktop context and the pinned PostgreSQL image was not present locally. No Docker resources were created.
