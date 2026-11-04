# CI-OPT-02 merge-gate policy

| Event                          | Checks                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Draft PR with low-risk changes | FAST. The FULL workflow classifies the diff, skips the integration workload and leaves the merge gate failed. |
| Ready PR                       | FAST and FULL on the current GitHub merge candidate.                                                          |
| Critical or unknown changes    | FAST and FULL, including Draft PRs.                                                                           |
| Push to main                   | One FULL suite and its merge gate on the integrated SHA. Separate main runs do not cancel one another.        |

The required GitHub checks are `FAST CI` and `FULL merge gate`, both from GitHub Actions App `15368`. Keep strict base freshness, pull requests required, protection enforced for administrators, and force pushes and branch deletion disabled. Manual workflow dispatch emits supplemental FULL evidence under a different check name. It cannot replace the required FULL merge gate.

The gate checks the successful FULL result against the live PR head, base and tested merge candidate. Base advancement requires a fresh candidate. A skipped, failed or cancelled FULL cannot pass the gate. When a PR changes CI configuration, review the exact diff before integration. GitHub binds a check to its App and name, so arbitrary PR edits to workflow code remain within the single-owner trust model.

The retired `R1 foundation` workflow is preserved as [a coverage fixture](legacy-ci.yml.txt). The policy tests compare every legacy step against the live FULL workflow in order.

## Switch and rollback

During activation, add the two new required checks alongside the legacy context, verify the new jobs on the switch PR, and then remove only the legacy context before merging the workflow retirement. Preserve the rest of branch protection. Confirm a successful post-merge FULL on the integrated SHA.

To restore legacy, first reintroduce its workflow in a normal PR with the current checks enforced. Verify the restored legacy on main and on a fresh candidate, then add its required context back alongside the two existing checks. Any subsequent removal of the new requirements follows verified legacy coverage.

[GitHub required checks and branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
