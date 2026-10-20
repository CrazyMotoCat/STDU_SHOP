# R1 Codex workflow hardening

This package adapts workflow/verification practices from AC_Expluatation without transferring CMMS implementation or .NET stack decisions. Source project main observed at commit 8362f59aded7c9a39dfaa29db5ed0bda82063e7d.

## Purpose
- Protect interrupted Codex work from loss and duplicate implementation.
- Cap agent parallelism and isolate write ownership.
- Enforce requirement-to-test traceability for critical workflows: parser candidate approvals, engineer revisions, costing and immutable quotations.
- Block destructive Git/Docker commands unless explicitly approved.

## Setup
Read AGENTS.md; keep original docs/spec requirements authoritative. Consult skills/README.md and invoke only matching skills. A baseline commit must exist before multi-agent writers start. Each R1 task has one owner for migrations and cross-module contracts.

## What is not included
No .NET scripts, no copied EAM domain entities, no RabbitMQ/Keycloak requirements, no business feature expansion, no application CI yet because R1-001 has not produced runnable apps. Implement JavaScript/TypeScript/Python tests and CI as part of R1-001, with a later focused PR.

## First-use verification (manual)
1. Find the exact skill file and read its frontmatter and stop conditions.
2. For R1-001, run repository-state-guard and capture base SHA.
3. Select BALANCED mode; do not create subagents without independent owned outputs.
4. Commit meaningful safe phases; preserve task checkpoint when pausing.
5. Check traceability against docs/spec/08_TESTS_AND_ACCEPTANCE.md before closing R1 tasks.

## Source provenance
- https://github.com/CrazyMotoCat/AC_Expluatation/tree/main/skills
- https://github.com/CrazyMotoCat/AC_Expluatation/blob/main/AGENTS.md

The adaptation uses STDU_SHOP's existing AGENTS.md rules and does not override approved decision register.
