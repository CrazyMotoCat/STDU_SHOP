# CI-OPT-01 integration handoff

## Prepared result

[Draft PR40](https://github.com/CrazyMotoCat/STDU_SHOP/pull/40), branch `codex/ci-opt-01-fast-full`, base main `59655a74ff4c815855eb416683c3c2db793c9af4`. REVIEW_REQUIRED / NO_MERGE. PR30 is integrated at that main SHA; [post-merge CI41621818797](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41621818797) SUCCESS. PR39 and other worktrees untouched. No production, FROZEN contract or protection change.

Workflows: `ci-fast.yml` (parallel JS, Python, frozen contracts, FAST aggregator), `ci-full.yml` (classifier, complete FULL, exact-revision gate, main/merge-group/manual coverage), retained `ci.yml` (complete legacy suite; only main concurrency isolation changed). Shared FAST setup in `.github/actions/ci-setup/action.yml`; scripts/tests in `scripts/ci`; routing, baseline, measurements, settings and rollback in `docs/ci`.

## Actual evidence

Exact source `5cb16a064228dca4a4d08df332ed56d9a2bf9447`, tested candidate `01136dcbf844da568efb2167130fd1fc3c881a05`:

- [FAST41624061165](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41624061165): SUCCESS,84s elapsed; JS47s/Python38s/contracts66s/aggregate12s.
- [FULL41624061174](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41624061174): SUCCESS including plan/gate; workload574s, total1137s including runner allocation.
- [Legacy41624061151](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41624061151): SUCCESS; workload687s, total708s.
- Independent architecture, Security/merge-gate and QA coverage reviews PASS exact5cb16a0. No P0/P1/P2 implementation findings. Reviewers independently checked code/policy tests; hosted evidence checked by lead.
- Local `node --test scripts/ci/*.node.mjs` (67 passed,0 skipped), actionlint1.7.12, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm contract:check`, `pnpm test`, `pnpm build`, `git diff --check`: PASS. Unit118JS/66Python passed;96JS environment-gated skips. Hosted FULL supplies runtime evidence; skipped units are not claimed passed.
- Exact legacy/FULL ordered-step and FAST contract-command parity preserves every FROZEN check, PostgreSQL/Redis runtime, R1-002B/004B/006B/007B/010B/010C, UI smoke, catalog browser acceptance, five-service Docker integration, host lifecycle x3, lint/format/types/test/build and unconditional cleanup.

Documentation-only follow-ups invalidate PR exact-head evidence. Final documentation SHA and fresh run/review results must be recorded in the PR handoff after completion. These source runs are evidence for5cb16a0 only.

## Gate and blockers

Always-running gate requires successful planner/current FULL, exact checkout/source/base/test candidate and live target ref. Missing/skipped/failed/cancelled/stale FULL fails; manual dispatch has a distinct supplemental context. Unknown paths, CI/shared/security/dependency changes, deletions and diff errors force FULL. Ready PRs always FULL; titles/labels cannot authorize skips. Policy tests cover negative cases and real Git merge-base behavior.

Authenticated API confirms main **protected:false**, classic protection404 `Branch not protected`, rulesets[] and branch rules[]. Admin access is available; this is not a permission limitation. No settings changed: separate owner authorization is required. GitHub currently does not enforce FULL for merge. PR-controlled policy can forge its own check; trusted external policy or enforced independent CI-owner review is necessary.

Six representative hosted benchmarks and actual Draft-to-Ready/new-head/negative-protection acceptance remain unexecuted. This critical CI-policy PR always routes FULL, so docs/CSS follow-up commits are not representative docs/CSS-only PRs. New manual workflows require presence on default branch. FAST met3minutes in one sample; >=50% wait reduction and cold/warm comparison remain UNVERIFIED. Legacy remains active for every PR during migration.

## Owner decision and rollback

**CI-OPT-01: BLOCKED** for full acceptance. P0:none found. P1: main gate/trusted-policy enforcement absent. P2: representative hosted benchmark/lifecycle/platform evidence incomplete. P3:none confirmed. These acceptance findings are distinct from passing implementation reviews.

Owner must authorize concrete Settings steps in `docs/ci/merge-gate-policy.md` and select an independent policy owner/trusted source. Initial required checks: legacy `quality-and-integration`, `FAST CI`, `FULL merge gate`, GitHub Actions source, strict freshness, independent review and no bypass. Complete negative scenarios and six benchmarks before separately approving legacy retirement.

Before activation close/revert this Draft; legacy remains. After activation restore/prove required legacy checks first, then revert new CI. Never disable an active required gate before its replacement is green/enforced. Stop for owner decision; do not merge this PR or change protection autonomously.
