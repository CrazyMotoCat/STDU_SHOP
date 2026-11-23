# WB-LAB-01 checkpoint

TASK E5A OFFLINE RUNNER COMPLETION
STATUS LOCAL_QUALITY_PASS_HOSTED_CI_PENDING
BRANCH codex/wb-lab-01, Draft PR #54
PUBLISHED_BASE 91925421e3ff428eda5756c132f450cdf4b78fd8
LOCAL_CHECKPOINT 70735ba37352bfb810eedbdadad567f5634d9749

E0a–E4a remain accepted. E4a ran on 17976ff576661756d8a3354873dbd7cfc8db6854, run da496b6c17c1458d86e9d4c299526c95. Evidence SHA-256 70c755b6e2e83d8bdecb69f0e1541e17b0f4b2bf8d77289f18ce868c1f23cc13. No historical evidence was rewritten or removed.

E5A_RUNTIME = NOT_RUN.
VDS_EQUIVALENCE = NOT_PROVEN.
PHYSICAL_POWER_LOSS_DURABILITY = NOT_PROVEN.

The complete concrete backend, separate watchdog, provisioner start gate, typed evidence and owner-gated entry point are prepared. Each workload has distinct resource scope. Protected intents precede create and never retry ambiguous Docker mutations. Cleanup pins IDs, configuration, volume identities and attachments. A shared bounded latest-sample buffer lets the watchdog continue when the runner stops reading. PID/start time is pinned across samples; late aborts prohibit final PASS. Process tests include SIGKILL, independent and restarted watchdog recovery, running media controller, watermark and foreign attachments.

Real local PostgreSQL 18.6 integration passed in an isolated WSL cluster on 2026-11-15. All three transactions committed; the third acknowledgment was discarded and reconciled through a new read-only session without a repeat INSERT. Row-lock timeout measured 1,000,843 us and statement timeout 2,504 ms. Wrong peer start time was denied. Exact-process shutdown confirmed and the temporary cluster was removed. This is amd64 Linux evidence and does not establish behavior of the pinned ARM64 container/cgroup/mount.

Independent backend and security reviews closed the reported P1 findings. The delayed-baseline P2 has a 300 ms inventory regression. Three consecutive concrete fake campaigns and the unresponsive-reader watchdog test passed before final checks. FAST now explicitly runs the root UID/process fixtures with sudo; the real PostgreSQL test remains opt-in.

Final local verification on 2026-11-18 passed: 126 WSL tests, 12 Windows Compose tests, three opt-in skips. Explicit real PostgreSQL integration passed separately using extracted packages at /tmp/wb-e5a-pg.g1QzrD/root. Row lock measured 1,000,478 us, statement timeout 2,502 ms, transaction plus reconciliation times 8,187 / 3,893 / 3,542 us. Independent backend and security Quality PASS, no open P0/P1/blocking P2 for offline publication. Next action is commit/push and FAST/FULL/mandatory merge gate on the published HEAD. PR stays Draft. No merge, physical WB execution, deployment, codec work or production action is authorized.
