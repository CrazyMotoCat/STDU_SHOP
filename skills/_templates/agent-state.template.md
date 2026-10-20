# Agent workstream state

TASK: R1-###
AGENT: <name>
ROLE: <scout|writer|reviewer>
STATUS: <NOT_STARTED|IN_PROGRESS|COMPLETE|BLOCKED>
BRANCH_OR_WORKTREE: <ref>
BASE_COMMIT: <sha>
WRITE_ALLOW:
- <path/glob>
DO_NOT_TOUCH:
- <path/glob>
FROZEN_CONTRACTS:
- <document/commit>
CHANGED_PATHS:
- <path>
ACTUAL_CHECKS:
- <command -> result>
BLOCKERS:
- NONE
NEXT_ACTION: <one next action>
