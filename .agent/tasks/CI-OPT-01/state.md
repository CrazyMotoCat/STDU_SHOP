# CI-OPT-01 checkpoint

- TASK: CI-OPT-01 Fast CI / Full CI, explicit user scope; delivery REVIEW_REQUIRED / SEPARATE_BRANCH / DRAFT_PR / NO_MERGE.
- BRANCH: `codex/ci-opt-01-fast-full`, own worktree `C:/Users/mvideo/.codex/worktrees/ci-opt-01-fast-full`.
- BASE: current fetched main `59655a74ff4c815855eb416683c3c2db793c9af4`, authorized PR #30 merge performed externally while this task was preparing. PR API confirmed MERGED, exact head3f316452, correct two-parent normal merge; tree equals authorized HEAD.
- Q0-01_POST_MERGE_CI: https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41621818797 initially in progress; success not yet verified because public API rate limit was reached. No direct main change was performed by this task.
- COMPLETED: parallel migration workflows FAST/FULL; old full suite retained (main concurrency fixed only); NUL-safe fail-closed classifier; exact revision gate; limited added-line secret/diff scan; shared FAST setup; immutable baseline snapshot; matrix/enforcement/rollback/benchmark docs.
- VERIFIED: 64 classifier/gate/parity/Git-fixture tests PASS; actionlint v1.7.12 PASS (official downloaded asset digest verified); lint and format PASS. Remaining local type/contracts/tests/build running at checkpoint.
- CONTRACTS_FROZEN: yes. No application/API/DB/auth/RBAC/production changes. PR #39 and other worktrees untouched.
- PROTECTION: public rulesets and branch rules returned empty arrays; classic protection query401. Enforcement UNVERIFIED; no settings changes authorized/performed. Required FULL cannot be claimed until owner settings proof.
- MIGRATION: legacy still runs full on every PR; runtime savings not active/claimed. FAST/Draft routing unit-tested; final CI-policy PR is critical and must execute FULL. Draft fast-only deliberately fails FULL merge gate until real full evidence exists.
- BLOCKERS: GitHub mutation connector absent/cached API credential unavailable; user is restoring connector. Do not retry login dialogs. Public read-only API later rate-limited. No Draft PR created yet, no hosted current-SHA FAST/FULL or six-scenario benchmark evidence.
- NEXT_ACTION: finish local gates, commit scoped implementation, obtain three independent exact-SHA reviews, push branch. Once authenticated GitHub is restored create one Draft PR and verify legacy/FULL/FAST on final head, collect actual benchmark/lifecycle evidence permitted by task. If access remains unavailable report exact outstanding gates, not READY.
- DO_NOT_REPEAT: no protection changes/production/mergeCI-OPT; do not manipulate #39/#28/#36/#37. Do not alter authorized merged #30. Avoid broad local Compose checks that could disturb shared ports; hosted legacy/FULL remains mandatory evidence.
