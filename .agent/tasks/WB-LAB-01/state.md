# WB-LAB-01 checkpoint

TASK: E0b failed evidence archival preparation
STATUS: E0B_RETRY_PREREQUISITES_READY_FOR_OWNER_DECISION
PHASE: PREPARATION_ONLY / NO_WB_WRITES / E0B_REPEAT_NOT_APPROVED / NO_MERGE
BRANCH: codex/wb-lab-01, Draft PR #54
RUNTIME_BASELINE: `36fb3cfc3ffb6831e7207415b2f277590ac494c2`

OBSERVED: one authorized E0b runtime `742071b6115e4a00a8b65cc7151f8c39` ended BLOCKED / E0B_DOCKER_COMMAND_FAILED. Readiness, DB identity, SQL sentinel, restricted role, actual cgroup equality and host file hashes passed. In-container sha256sum exited 1. Actual loopback and final OOM checks were not reached. Cleanup CONFIRMED and prior inventory preserved.

CAUSE: the wrapper used umask 077. A root-owned sentinel requested as 0444 became 0400, denying the UID 999 reader. This explains the observed failure. Inode metadata and stderr were not retained.

FIX: explicitly fchmod the exclusively opened synthetic sentinel FD to 0444, verify regular type and mode with fstat and retain both fsyncs. Add a bounded hash read failure code and regressions for permissions, UID 999, collision, descriptor errors and cleanup.

PREPARED: `archive_e0b_failed.py` pins the failed run and digest, validates the ledger, WB mount, private modes and resource absence, then uses a no-replace rename to the existing archive. Directory fsync and post-move hash and empty-root checks are mandatory. Offline regressions cover exact archival and refusal without source loss.

VERIFICATION: the sentinel fix at `2f0246c73d25045cf572a350884a441f41383666` passed Quality and FAST/FULL. The archival change has a separate offline test suite and requires its own independent review and hosted FAST/FULL verification.

EVIDENCE: blocked run raw SHA-256 `dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28`. Local and WB copies match. Accepted E0a remains closed and archived with SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`.

NEXT: separate OWNER_E0B_RUNTIME_APPROVED on the new reviewed HEAD is required for actual archival and one repeat. Preserve the failed run before any future approved preflight. E1–E5 NOT_RUN. VDS equivalence NOT_PROVEN.
