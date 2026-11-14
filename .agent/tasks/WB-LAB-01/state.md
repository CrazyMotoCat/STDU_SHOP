# WB-LAB-01 checkpoint

TASK E4A-MASK-POLICY-FIX
STATUS E4A_MASK_FIX_READY_FOR_OWNER_RUNTIME_DECISION
BRANCH codex/wb-lab-01, Draft PR #54
BASELINE 06af094750f6a3c77da7acd09325a1e84d1dcdff

E3 accepted. The E4a-only retry stopped at UNEXPECTED_MOUNT with cleanup CONFIRMED. The exact mount and origin remain unproven. Both failed E4a runs remain hash-pinned in the history gate.

The namespace probe now records a bounded mount report from one snapshot. The exact allowlist and canary criteria are preserved. The local Docker fixture confirms the normal RO profile and rejects a real unknown RW tmpfs before network probes. See experiments/wb-lab-01/RUNTIME-E4A.md. The next physical E4a-only run requires OWNER_E4A_ONLY_RUNTIME_APPROVED on the reviewed HEAD.

Third E4a diagnostic identified /proc/asound, RO tmpfs, root /. Historical provenance remains MASK_ORIGIN_NOT_PROVEN. The conditional exception requires live Docker mask policy and exact mount attributes. The next run retains all historical hashes.
