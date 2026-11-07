# WB-LAB-01 checkpoint

TASK: WB-LAB-01 E0a closeout + E0b preparation
STATUS: E0A_CLOSED / E0B_READY_FOR_OWNER_DECISION
PHASE: PREPARATION_ONLY / NO_MERGE / NO_E0B_EXECUTION
CHECKPOINT_STATUS: SAFE
LAST_SAFE_COMMIT: 6637080541348b95623641464f4de1add07f0fb4 (accepted E0a)
BRANCH: codex/wb-lab-01; PR #54 remains Draft, based on #53.

COMPLETED: README and RUNTIME-E0A reconcile accepted runtime evidence and limitations. Prepared separately gated E0b runner: exact-ID PG container, two owned volumes, synthetic DB/role/schema/sentinels, readiness, actual-cgroup assertions, independent watchdog, scoped bounded cleanup and atomic evidence. Prepared hash-pinned archival of accepted E0a evidence; not executed. Added offline negative/orchestration tests and FAST CI step.

VERIFIED: python -B -m unittest discover -s experiments/wb-lab-01: 44 tests, OK with two Linux-only skips on Windows. Ruff check and format passed. Independent read-only Quality PASS for preparation, independently ran 43 tests before the final additional volume-binding negative test. Exact-head hosted FAST/FULL must be verified after push; no pass inferred here.

DECISIONS: Owner accepted E0a on the LAST_SAFE_COMMIT; do not repeat. E0b preparation authorized, but creating PG/volumes or SQL writes on WB not authorized. No contracts/API/migrations/production files changed. E0b-E5 NOT_RUN; VDS_equivalence NOT_PROVEN.

EVIDENCE: E0a accepted run23ceb807c68f4ae0bed724def6e58d68 retained on WB; SHA256 3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e. No archival performed in this preparation task. Raw evidence remains private.

BLOCKERS: Pinned PG image availability and ARM64 UID/tool compatibility not established locally on WB; cold initdb latency and memory/IO not measured. Accepted E0a evidence intentionally occupies lab root; archive only after separate E0b authorization using the prepared strict procedure. Disk watermark is sampled, not a quota. Host supervisory overhead not PG-cgroup-bound.

DO_NOT_REPEAT: E0a, 02B benchmark, architecture proof experiments. No E0b-E5, merge, prune, deployment, reboot, firmware/firewall/host changes or production migrations.

NEXT_ACTION: After exact-head CI, await OWNER_E0B_RUNTIME_APPROVED on the reviewed revision (and pinned-image acquisition as needed), then the agent alone performs the bounded prepared sequence; no manual owner command work required.
