---
name: efficient-orchestrator
description: Choose minimal Codex agent allocation for non-trivial STDU_SHOP tasks; use when planning cross-file implementation, parallel workers, expensive reviews, or quota-sensitive work.
---

# Efficient Orchestrator — STDU_SHOP

Adapted from AC_Expluatation/skills/efficient-orchestrator. The project owner orchestrates decisions; one lead Codex agent owns integration.

## Default: BALANCED
- T0: typo or one-file mechanical change -> lead works alone.
- T1: bounded change within one module -> lead usually works alone.
- T2: multiple independent modules -> lead plans and can delegate up to two non-overlapping writers.
- T3: pricing/approval/security, database migrations, auth, quote immutability, ingestion publishing, or shared API -> lead freezes contracts first; add independent read-only review.
- ECONOMY: 0–1 writer; FAST: at most 3 genuinely independent writers; QUALITY: independent reviewer for high-risk work. Treat agent counts as ceilings, not targets. Never assume model names or quotas.

## Lead agent owns
Business interpretation, release R1 boundaries, acceptance criteria, schema/DTO/OpenAPI/permission decisions, migration order, branch integration, final verification, and the user-facing report.

## Parallelism gate
Only parallelize after all conditions hold:
1. Inputs, outputs and acceptance criteria are stable.
2. Workstreams do not require each other's unfinished changes.
3. One writable owner exists for every file, migration, shared DTO, permission and generated contract.
4. Integrating is cheaper than sequential implementation.
5. Each stream can verify its result independently.

In STDU_SHOP: frontend and NestJS may work in parallel **after** freezing OpenAPI and error codes; Python ingestion workers may independently implement extraction against immutable staged-result contracts. Never let Python publish products or approve quotes.

## Context economy
Read AGENTS.md, exact R1-### backlog item, relevant module section from docs/spec/03_MASTER_TZ_R1.md, and required architecture/security invariants. Do not load every spec or ask many scouts to inspect the same subsystem. Workers return changed paths, tests actually executed, findings, blockers and next action.

## Completion
Smallest meaningful verification first (lint/typecheck/unit), then affected integration, then broader regression appropriate to risk. Use multi-agent-review after multiple writers or high-risk changes. No green report without actual evidence.

## Output
- TASK / TIER / MODE
- CONTRACTS_FROZEN: yes|no
- PARALLELIZABLE: yes|no and why
- WORKERS: roles, WRITE_ALLOW, DO_NOT_TOUCH
- VERIFICATION: exact checks and outcomes
- NEXT_ACTION
