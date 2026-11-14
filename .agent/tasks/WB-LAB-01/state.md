# WB-LAB-01 checkpoint

TASK E4A-MOUNT-DIAG
STATUS E4A_MOUNT_DIAG_READY_PENDING_WB_MEASUREMENT
BRANCH codex/wb-lab-01, Draft PR #54
BASELINE 06af094750f6a3c77da7acd09325a1e84d1dcdff

E3 accepted. The E4a-only retry stopped at UNEXPECTED_MOUNT with cleanup CONFIRMED. The exact mount and origin remain unproven. Both failed E4a runs remain hash-pinned in the history gate.

The namespace probe now records a bounded mount report from one snapshot. The exact allowlist and canary criteria are preserved. The local Docker fixture confirms the normal RO profile and rejects a real unknown RW tmpfs before network probes. See experiments/wb-lab-01/RUNTIME-E4A.md. The next physical E4a-only run requires OWNER_E4A_ONLY_RUNTIME_APPROVED on the reviewed HEAD.
