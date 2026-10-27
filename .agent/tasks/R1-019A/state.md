# R1-019A — public error and recovery UX

TASK: R1-019A
STATUS: COMPLETE
DELIVERY_MODE: REVIEW_REQUIRED
BASELINE_MAIN: 4b358f16a90998fdae2d2981601e9ccf3bfdf7f0
INTEGRATION_BASE: f62c124adb2dbd46f8040a8dfef2644f29834bad
BRANCH: codex/r1-019a-public-errors
APPROVED_HEAD: 92991a3d063c395dde39097546de2602780130eb
MERGE_SHA: afa2978e2d2a1d69f5187920c36a76ee654d65fc
SCOPE: Public Next.js 404/error presentation and catalog not-found distinction only; no API, DB, RBAC, FROZEN contract, staff UI, Docker, or R1-010B changes
SOURCE_REQUIREMENTS: Owner task R1-019A; CAT-08 noindex on error pages; preserve the catalog's local API outage message
CHANGES: Explicit NO_INDEX_ROBOTS on shared not-found so missing products remain noindex inside the public catalog layout; browser smoke asserts the directive
VERIFIED: Prettier check; git diff --check; frontend typecheck; production builds; catalog:ui:smoke on approved HEAD and merged main (isolated API fixtures, HTTP 404/noindex, API outage message preserved); production browser check on approved HEAD (generic HTTP 500/noindex error, retry recovery, keyboard focus, 1440/375 overflow)
PR_CI: SUCCESS on approved HEAD https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/40480746880
POST_MERGE_CI: SUCCESS on merge SHA https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/40482884165
SCREENSHOTS: artifacts/verification/R1-019A (404 desktop/mobile; error desktop/mobile), preserved in the R1-019A worktree
ENVIRONMENT_NOTE: Production SEO settings were not changed. Local production smoke used indexing disabled; test-only SEO fixture values were scoped to local subprocesses. Node 24.22.1 warns against repository-pinned 24.19.0.
PR: https://github.com/CrazyMotoCat/STDU_SHOP/pull/21 (merged)
NEXT_ACTION: none
