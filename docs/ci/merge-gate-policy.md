# Required checks and merge gate — owner activation procedure

## Live observations and trust boundary

Authenticated API observations, refreshed on 2026-11-04 (Asia/Vladivostok):

- `GET /repos/CrazyMotoCat/STDU_SHOP/rulesets` → 200 `[]`.
- `GET /repos/CrazyMotoCat/STDU_SHOP/rules/branches/main` → 200 `[]`.
- `GET /repos/CrazyMotoCat/STDU_SHOP/branches/main` → 200, `protected: false`, required-status-check enforcement `off`, no contexts/checks.
- `GET /repos/CrazyMotoCat/STDU_SHOP/branches/main/protection` → 404, `Branch not protected`.

The authenticated repository credential has administrative access; this is confirmed **UNPROTECTED**, not an API-permission limitation. The earlier unauthenticated 401 observation is superseded. No protection setting was changed: the task explicitly requires a separate owner authorization for that operation. FULL is **not mandatory for merge in current GitHub settings**. This is an acceptance blocker until owner-authorized settings and negative merge tests establish enforcement.

PR-controlled workflow/classifier/gate changes can forge checks; self-tests alone do not establish a trusted security boundary. In an organization with the capability, prefer a required workflow sourced from separately protected policy. This user-owned repository may not support organization-required workflows. The owner must choose a supported enforcement path before disabling legacy CI.

For a repository-level fallback, require independent Code Owner review of `.github/**`, `scripts/ci/**`, dependency/toolchain/build configuration and the CODEOWNERS file itself, dismiss stale approvals/require last-push approval, and prevent bypass/direct pushes. The policy owner must be a real independent reviewer with write access: do not create a nonexistent team, make the PR author self-approve, or silently grant anyone permissions. A file in this Draft is not an active required-owner review rule. These settings/owners are a separate owner decision.

## Exact Settings steps — do not execute without authorization

1. Open **Settings → Rules → Rulesets** and **Settings → Branches → Add branch protection rule** for exact branch `main`. Current settings have no active protection. Obtain the separate owner authorization, then record chosen active enforcement, actor bypass list and required check app/source. Include the original `quality-and-integration` check in the initial protected configuration and preserve any settings added by another authorized owner in the meantime. Require PRs and independent policy-owner approval; prohibit force pushes/deletion and apply protection to administrators/bypass actors as supported.
2. Run this Draft's legacy `R1 foundation`, FAST and FULL on the exact final head and candidate. Confirm actual check names in the Checks/API (expected job contexts: `FAST CI`, `FULL CI`, `FULL merge gate`; workflow display may prepend its name). Require the **GitHub Actions app** source, not an arbitrary same-name external status.
3. Add `FULL merge gate` and `FAST CI` as required while keeping `quality-and-integration`. Enable strict up-to-date branches or a proven merge queue (both new FULL trigger `merge_group` and legacy compatibility must be verified before enabling a queue). The merge gate's success does not automatically become stale after a later base push; this rule closes that platform gap.
4. Activate the trusted-policy/independent CI-owner review path described above. Protect modification/deletion of workflow, classifier, gate and CODEOWNERS. Validate that an unauthorized same-name fake-green workflow cannot pass acceptance. Without this step, malicious workflow editing remains a known protection gap.
5. Negative tests on a disposable owner-approved PR: Draft FAST-only + missing/skipped FULL must block; fail/cancel FULL must block; new push after success must wait; retarget/base advancement must require fresh candidate; delete full workflow must leave required gate unsatisfied; edit its gate to a fake success must be rejected by trusted policy/owner review. Do not test bypass by weakening live main settings.
6. Prove Draft→Ready and subsequent Ready push run FULL on current head and candidate. Recheck metadata and tests after each update. Labels/title are never skip authorization.
7. Only after successful authenticated enforcement proof, independent review and owner approval: prepare a **separate activation change** that stops the old unconditional PR FULL workflow. Do not remove the required legacy check until the new required gates are active and green. The current Draft does not make this switch.
8. Record settings screenshots/API output, exact SHAs, candidate, check app IDs and run URLs. Confirm post-merge full runs for consecutive main SHAs finish without cancellation/replacement. Require final exact-head FULL immediately before merging any Ready PR.

## Failure modes deliberately rejected

`FULL merge gate` always executes; it does not accept skipped/neutral/cancelled jobs. It requires successful planner, successful current FULL, valid checkout identity, live PR head/base/target ref/test candidate equality and mergeability. FAST green alone is never permission to merge. Deleted workflow cannot produce the required gate when settings are enforced. Modified malicious policy still needs an external trust control; this code does not pretend to prevent arbitrary self-modification.

Manual dispatch is supplemental evidence, not a PR-required-check shortcut. Wrong/stale expected SHA or API error fails. Only `pull_request` / `merge_group` runs associated with the current candidate should satisfy the owner-configured PR requirement.

## Official sources

- [Required status checks, skipped jobs and merge-queue event association](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [Protected branches and check sources](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [CODEOWNERS and protection of policy files](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
- [Workflow concurrency and dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Organization/enterprise required workflow capability](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

Manual dispatch emits **Supplemental FULL evidence**, a separate job/check name. It never publishes the required **FULL merge gate** context, so branch-head supplemental evidence cannot substitute for PR candidate validation. This distinction is asserted in policy tests.
