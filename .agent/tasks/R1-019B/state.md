# R1-019B — Technical SEO Foundation

TASK: R1-019B
STATUS: WAITING_OWNER_REVIEW
DELIVERY_MODE: REVIEW_REQUIRED
BASELINE_MAIN: c8b10f07522d0d72bd52834607e154abbd0c28c6
BRANCH: codex/r1-019b-seo-foundation
SOURCE_REQUIREMENTS: Owner task R1-019B; CAT-08; related R1-018 SEO backlog scope
SCOPE: Next.js robots/sitemap and public metadata only; default noindex, production opt-in with explicitly configured HTTPS origin; no dynamic catalog enumeration
VERIFIED: Prettier; targeted ESLint; 15 SEO configuration tests; @stdu/web typecheck; production builds with indexing enabled and safe default; HTTP robots/sitemap and four unique title/description sets; staff and RFQ preview noindex; no localhost sitemap URLs; route manifest unchanged except robots.txt and sitemap.xml
CONFIGURATION: Same APP_ENV, PUBLIC_WEB_ORIGIN, PUBLIC_SITE_INDEXING_ENABLED values required at web build and runtime; rebuild after changes; see apps/web/SEO.md
BOUNDARIES: PR #21 and R1-010B unchanged; no backend, API, Prisma, RBAC, Docker, Staff UI, or FROZEN contract edits
NEXT_ACTION: One automatic full GitHub CI on the final PR HEAD, then owner review; Draft PR only, no merge
