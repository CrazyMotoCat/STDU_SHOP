# R1 task state

TASK: R1-###
STATUS: IN_PROGRESS
CHECKPOINT_STATUS: UNSAFE
PHASE: <phase>
UPDATED_AT: <ISO-8601>
BRANCH: <branch>
LAST_SAFE_COMMIT: <sha|NONE>

## COMPLETED
- Only finished, verified work.

## VERIFIED
- Command: <exact command>; result: PASS|FAIL|NOT_RUN; evidence: <log link/path>.

## UNCOMMITTED
- Known dirty paths and file owners, or NONE.

## PENDING
- Specific incomplete work.

## DECISIONS
- Frozen contracts and explicit owner-approved choices.

## BLOCKERS
- NONE, or concrete blockers.

## FILES_CHANGED
- <path>: <purpose>.

## NEXT_ACTION
<One executable next action.>

## DO_NOT_REPEAT
- Already completed work.

## RESUME_NOTES
- Avoid secrets, customer documents and speculative claims.
