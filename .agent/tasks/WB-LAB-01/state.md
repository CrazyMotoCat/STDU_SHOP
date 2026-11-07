# WB-LAB-01 checkpoint

TASK: E0b sentinel permissions fix
STATUS: E0B_FIX_READY_FOR_OWNER_RETRY_DECISION
PHASE: OFFLINE_FIX / E0B_REPEAT_NOT_APPROVED / NO_MERGE
BRANCH: codex/wb-lab-01, Draft PR #54
RUNTIME_BASELINE: `36fb3cfc3ffb6831e7207415b2f277590ac494c2`

OBSERVED: one authorized E0b runtime `742071b6115e4a00a8b65cc7151f8c39` ended BLOCKED / E0B_DOCKER_COMMAND_FAILED. Readiness, DB identity, SQL sentinel, restricted role, actual cgroup equality and host file hashes passed. In-container sha256sum exited 1. Actual loopback and final OOM checks were not reached. Cleanup CONFIRMED and prior inventory preserved.

CAUSE: the wrapper used umask 077. A root-owned sentinel requested as 0444 became 0400, denying the UID 999 reader. This explains the observed failure. Inode metadata and stderr were not retained.

FIX: explicitly fchmod the exclusively opened synthetic sentinel FD to 0444, verify regular type and mode with fstat and retain both fsyncs. Add a bounded hash read failure code and regressions for permissions, UID 999, collision, descriptor errors and cleanup.

VERIFICATION: targeted E0b and full WB offline suites are run locally. FAST includes the actual UID 999 read test on Linux. Review and hosted FAST/FULL are verified against the pushed fix SHA.

EVIDENCE: blocked run raw SHA-256 `dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28`. Local and WB copies match. Accepted E0a remains closed and archived with SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`.

NEXT: separate OWNER_E0B_RUNTIME_APPROVED on the reviewed fix HEAD is required for a repeat. Preserve the failed run before any future approved preflight. E1–E5 NOT_RUN. VDS equivalence NOT_PROVEN.
