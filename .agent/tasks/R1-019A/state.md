# R1-019A — public error and recovery UX

TASK: R1-019A
STATUS: WAITING_VISUAL_APPROVAL
DELIVERY_MODE: REVIEW_REQUIRED
BASELINE_MAIN: 4b358f16a90998fdae2d2981601e9ccf3bfdf7f0
SYNCED_MAIN: c42110ec7a9273203c996467739e6783abe55bed
SYNC_COMMIT: 2fbfcf1480f9650e02aff32d38bc3b17d691dd85
BRANCH: codex/r1-019a-public-errors
SCOPE: Public Next.js 404/error presentation and catalog not-found distinction only; no API, DB, RBAC, FROZEN contract, staff UI, Docker, or R1-010B changes
SOURCE_REQUIREMENTS: Owner task R1-019A; CAT-08 noindex on error pages; preserve the catalog's local API outage message
CHANGES: Explicit NO_INDEX_ROBOTS on shared not-found so missing products remain noindex inside the public catalog layout; browser smoke asserts the directive
VERIFIED: Prettier check; git diff --check; @stdu/web typecheck; clean production build; catalog:ui:smoke with isolated API fixtures (18 product requests, missing product HTTP 404/noindex, API outage message preserved); production error-boundary probe (HTTP 500/noindex, generic content, retry recovery); keyboard focus and 1440/375 overflow checks
SCREENSHOTS: artifacts/verification/R1-019A (404 desktop/mobile; error desktop/mobile)
ENVIRONMENT_NOTE: SEO flags and fixture origin were set only in local test subprocesses; no working environment was changed. Node 24.22.1 warns against repository-pinned 24.19.0; local checks passed.
PR: https://github.com/CrazyMotoCat/STDU_SHOP/pull/21 (open, Draft, not merged)
CI: Prior run 40331548250 succeeded on original HEAD; updated HEAD CI will run after push.
NEXT_ACTION: verify CI for updated HEAD and owner visual approval; do not merge
