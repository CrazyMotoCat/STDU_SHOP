---
name: task-decomposer
description: Split a multi-part STDU_SHOP backlog task into independent Codex workstreams with explicit ownership and frozen contracts.
---

# Task Decomposer — STDU_SHOP

Adapted from AC_Expluatation/skills/task-decomposer.

## Input
Exact task R1-### and its acceptance criteria from docs/spec/09_ROADMAP_BACKLOG.md; affected modules; approved scope/non-goals.

## One writable owner per file
For each worker give WRITE_ALLOW, READ_ALLOW, DO_NOT_TOUCH, expected output, focused tests and escalation criteria. Shared files, OpenAPI schema, Prisma/TypeORM migrations, auth policy, generated API client, package lockfiles and common DTOs must have a single writer for each parallel phase.

Never delegate speculative business-rule decisions. The owner/lead freezes DTOs, endpoints, price formulas, status transitions, parser candidate schema and accepted/rejected approval semantics first. Parallel work may then implement NestJS API, Next.js UI, Python parsing or tests in disjoint files.

## Dependency graph
Define A -> B and B,C -> REVIEW; no dependency cycles. If work spans the same 1–3 closely coupled files, skip delegation. Default BALANCED mode uses up to two writers; extra workers only after independence is proven.

## Risk
Classify HIGH for quote approval/immutability, price/tax arithmetic, parser publishing, customer/private document access, migrations, concurrency and authorization. Require separate reviewer for HIGH.

## Output
TASK / PARALLELIZABLE / REASON / RISK / AGENTS (goal, files owned, constraints, tests) / DEPENDENCIES / MERGE_ORDER / FINAL_REVIEW_REQUIRED / DOCUMENTATION_OWNER.

Skill plans work; it does not implement the task.
