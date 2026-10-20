---
name: multi-agent-review
description: Independently inspect integrated STDU_SHOP Codex changes after multiple writers or high-risk approval, pricing, auth, ingestion, or migration edits.
---

# Multi-Agent Review — STDU_SHOP

Adapted from AC_Expluatation/skills/multi-agent-review. Reviewer defaults to READ_ONLY; report findings before proposing targeted fixes.

## Inputs
Task contract, approved R1 requirements, merged diff, test evidence, workstream file ownership, architecture/API/permission contracts.

## Checklist
1. Scope: no customer order, warehouse, production control, auto-substitutes, parser scheduling or bulk approval in R1.
2. Integrity: no duplicate DTOs, migrations, routes, approval rules, status enums, file conflicts or generated-code drift.
3. Architecture: Next.js presentation, NestJS domain authority, Python staging-only results, PostgreSQL source of truth; no backend RBAC delegated to UI.
4. Business: every changed acceptance criterion and applicable approved decision covered.
5. Data: migrations, transactions, immutable approved quotation snapshots, safe decimals, currency/tax handling, idempotent supplier imports.
6. Security: guest/admin separation, role/organization scope, quote-link expiry/revocation, file access, SSRF on supplier parsing, confidential pricing never leaked.
7. API: frozen routes/DTOs/errors, meaningful 401/403/409 responses, safe concurrency, correct status commands.
8. Tests: negative authorization, invalid transitions, stale price behavior, repeated import/approval, concurrent updates and E2E where required.
9. Documentation: code/contract/ADR/backlog alignment.
10. Agent boundaries: actual diff stays within each writer's approved files.

## Findings
Severity BLOCKER / HIGH / MEDIUM / LOW / NOTE, exact path/evidence, suggested fix owner. PASS requires all applicable acceptance criteria verified and no unresolved BLOCKER/HIGH. After fixes rerun affected checks and review. Do not treat agent self-reports as proof.

## Output
MULTI_AGENT_REVIEW: PASS|FAIL; TASK; RISK; FINDINGS; FIX_OWNERS; RETEST_REQUIRED; FINAL_DECISION.
