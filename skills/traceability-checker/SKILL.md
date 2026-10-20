---
name: traceability-checker
description: Ensure a completed STDU_SHOP feature traces approved requirement and acceptance criteria to implementation, security checks, tests and documentation.
---

# Traceability Checker — STDU_SHOP

Adapted from AC_Expluatation/skills/traceability-checker. Use as final quality gate for R1 business rules, permissions, statuses, API or data changes. Skip tiny cosmetic changes.

## Source
Exact R1-### task, docs/spec/01_DECISION_REGISTER.md, docs/spec/03_MASTER_TZ_R1.md, docs/spec/08_TESTS_AND_ACCEPTANCE.md, merged diff and relevant contracts. These documents are authoritative; do not invent new features from test names.

## Trace each acceptance criterion
AC -> approved decision(s) -> domain rule -> permission if relevant -> lifecycle transition if relevant -> DB/API implementation -> tests -> affected docs.
Mark N/A for genuinely inapplicable elements; do not create artificial events, statuses or RBAC.

## Highest-risk R1 paths
- Parser only stages candidate data; **individual** admin approval makes it publishable.
- Identical SKU match requires brand+original code+modification and manual association.
- Engineer manually approves technical interpretation and selects functional substitutes.
- Pricing uses decimal, configured seller tax rules and explicit manager approval.
- Approved quote revisions are immutable and do not auto-update when supplier prices change.
- Public/client URLs cannot expose internal costs, comments, supplier secrets or private files.

Require negative authorization tests, rejection of invalid state transitions and race/idempotency tests where applicable. Report TEST_GAP, SCOPE_CONFLICT, PERMISSION_GAP, MIGRATION_GAP or DOC_UPDATE_REQUIRED with actionable file references.

## Output
TASK / AC_MATRIX: each AC with rule, implementation path, test path, documentation and COVERED|PARTIAL|MISSING|CONFLICT / GAPS / READY_TO_COMPLETE: YES|NO.
