# WB-LAB-01 checkpoint

TASK E4A-FIX
STATUS E4A_FIX_READY_FOR_OWNER_RUNTIME_DECISION
BRANCH codex/wb-lab-01, Draft PR #54
BASELINE c1422e4269e2f59a2903e29ea2f5e1d7a00439e2

E3 accepted. Original E4a evidence remains unchanged. ROOT_CAUSE_NOT_PROVEN is preserved. The fix adds actual RO media validation, sanitized start/probe/state diagnostics, same-FD retained-history parsing, and an E4a-only entry point. The combined E3/E4a runner is retired.

Local tests and disposable named-RO-volume probe verify the new profile. See experiments/wb-lab-01/RUNTIME-E4A.md. A physical retry requires OWNER_E4A_ONLY_RUNTIME_APPROVED on the reviewed HEAD. E5 remains NOT_RUN. PR #54 remains Draft.
