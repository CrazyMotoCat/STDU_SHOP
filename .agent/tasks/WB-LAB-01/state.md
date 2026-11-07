# WB-LAB-01 checkpoint

TASK E2 preparation
STATUS E2_READY_FOR_OWNER_RUNTIME_DECISION
BRANCH codex/wb-lab-01, Draft PR #54
BASELINE d1b1a3633d292e5d364e5252195340898fb2dafe

Owner accepted E1_RUNTIME_PASS. E0b and E1 raw evidence hashes are pinned in runtime_e2.py and preserved in their existing private WB directories. This preparation performs no WB execution.

E2 reuses E0b's bounded PG lifecycle and adds six sequential SQL cases with real row-lock barriers, clock_timestamp expiry, generation fencing, hash/size checks, COMMIT-response loss/replay and constraint rollback. The final delayed-COMMIT case explicitly measures the decision-time expiry boundary. Runtime limits and scoped cleanup retain the existing profile.

Local verification includes all WB offline tests and a separately labeled local disposable PostgreSQL 18.6 test on Docker Desktop. All six SQL scenarios passed and the exact test container was removed, preserving prior Docker inventory. Review and final hosted FAST/FULL are verified against the pushed implementation revision.

E2 on WB is NOT_RUN. Separate OWNER_E2_RUNTIME_APPROVED is required on the reviewed HEAD. E3–E5 NOT_RUN. VDS equivalence NOT_PROVEN. Next action is the owner decision after the complete review/CI report.
