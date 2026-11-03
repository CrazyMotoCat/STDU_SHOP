# CI benchmark — measured data versus unverified targets

## Historical measured baseline

The following job execution durations were fetched from the public GitHub Actions jobs API during this task. They are job `completed_at - started_at`, excluding workflow queue/setup outside the job, and can differ by a few seconds from the supplied UI workflow durations. No calculated speedup is reported as a measurement.

| Run / exact SHA                                                                                                                       | Job seconds | Supplied workflow UI duration | Outcome |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------- | ------- |
| [PR39 run41613551956](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41613551956), `41954899155c6d9a360ef20e3e4b65cc2bf52b82` | 679         | 11:23                         | SUCCESS |
| [PR38 run41609982663](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41609982663), `6ecfc530e608b917c85b6dfebc1b0b9867351202` | 643         | 10:47                         | SUCCESS |
| [Main run41470056146](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41470056146), `a2a19c9fe07b7afac6dfc46996c1294ea3111b6a` | 682         | 11:31                         | SUCCESS |
| [PR28 run41466242945](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41466242945), `5c4b6f4ac3514b4155b4e8ec3e2cce2be9f9a0db` | 1164        | 19:29                         | SUCCESS |

All are the historical complete `quality-and-integration` suite. Raw API job/step timing metadata is retained in ignored `.local/evidence/baseline-runs.json`. These are historical measurements, not new-workflow results.

## New workflow measurement matrix

| Scenario                          | Route policy                                                    | Hosted evidence / duration             |
| --------------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| Docs-only                         | FAST; Draft FULL skipped and merge gate intentionally not green | NOT MEASURED                           |
| CSS-only allowlisted page/catalog | FAST frontend; no Docker in FAST                                | NOT MEASURED                           |
| Catalog frontend                  | FAST units/contracts                                            | NOT MEASURED                           |
| Parser implementation             | FAST plus FULL (file-ingestion security boundary)               | NOT MEASURED                           |
| Security/backend                  | FAST plus FULL even in Draft                                    | NOT MEASURED                           |
| Final Ready HEAD                  | FAST plus FULL and exact-revision merge gate                    | NOT MEASURED                           |
| Final CI-OPT-01 HEAD              | FAST + FULL + legacy (CI policy changes force FULL)             | PENDING authenticated PR / hosted runs |

Classifier and gate unit scenarios cover these routes and adverse lifecycle cases locally; they are **not** real Actions benchmarks or proof that GitHub branch protection rejects a merge. This CI-policy PR always routes FULL, including docs-only follow-up commits, because classification covers the whole PR diff from merge-base. Do not label a small follow-up commit in this PR a docs-only benchmark.

New workflow dispatch requires presence on default branch. Meaningful six-scenario hosted measurements need owner-approved representative branches/PRs after rollout or an approved benchmark harness; this task creates only one CI-OPT Draft PR and does not mutate PR #39 or other agents' branches to manufacture data.

## Acceptance targets and reporting method

FAST target is 60–180 seconds including job setup, subject to cold caches/runner availability. FAST static jobs run in parallel; no Docker/E2E/build. FULL retains the original sequential workload; it has a small planning/gate/policy-test overhead. It is not asserted to be faster until measured.

For every real run record exact source HEAD, tested merge SHA, base SHA, run URL, job start/completion, workflow queue time separately, result, executed and skipped suites. A new commit invalidates old FULL evidence. Record cold versus warm caches and repeated measurements before comparing.

The ≥50% waiting-time reduction across intermediate commits remains **UNVERIFIED**. During migration legacy FULL remains active on every PR and aggregate wait is not reduced. After separately approved protection activation and legacy retirement, compare actual repeated Draft FAST runs plus one final FULL against the same number of legacy runs. Report arithmetic estimates as estimates only; do not claim success from classifier timings.
