# R1-019A — public error and recovery UX

TASK: R1-019A
STATUS: WAITING_VISUAL_APPROVAL
DELIVERY_MODE: REVIEW_REQUIRED
BASELINE_MAIN: 4b358f16a90998fdae2d2981601e9ccf3bfdf7f0
BRANCH: codex/r1-019a-public-errors
SCOPE: Public Next.js 404/error presentation and catalog not-found distinction only; no API, DB, RBAC, FROZEN contract, staff UI, Docker, or R1-010B changes
SOURCE_REQUIREMENTS: Owner task R1-019A; CAT-08 only for noindex on error pages
VERIFIED: Prettier check; git diff --check; @stdu/web typecheck; @stdu/web production build; catalog:ui:smoke with isolated 400/404/503 fixtures; production browser smoke verified 404 status/noindex/navigation/keyboard focus at 1440/375 and error boundary status 500/noindex/generic output/retry/reopen/recovery at 1440/375
ENVIRONMENT_NOTE: Node 24.22.1 warns against repository-pinned 24.19.0; checks passed. Windows lifecycle smoke needed a temporary local Python helper config, removed after each run.
SCREENSHOTS: artifacts/verification/R1-019A (404 desktop/mobile; error desktop/mobile)
PR: pending
NEXT_ACTION: commit and publish Draft PR; stop for owner visual approval; do not merge
