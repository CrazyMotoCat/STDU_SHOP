---
name: docs-impact
description: Identify the minimal STDU_SHOP documentation updates required by a feature, migration, API change, security rule or accepted decision.
---

# Documentation Impact — STDU_SHOP

Adapted from AC_Expluatation/skills/docs-impact. This skill identifies affected files, not rewrites them.

## Input
Exact task and changed paths/merged diff. First read docs/spec/00_README.md to locate source-of-truth documents; load only sections relevant to the change.

## Map changes to documents
- Approved scope/business rule -> docs/spec/01_DECISION_REGISTER.md and docs/spec/03_MASTER_TZ_R1.md, only after **user approval** of altered decision.
- Release boundary -> docs/spec/02_RELEASE_SCOPE.md and docs/spec/09_ROADMAP_BACKLOG.md; never silently expand R1.
- Entities, schema, calculations -> docs/spec/05_DOMAIN_MODEL.md and relevant ADR if architectural.
- Routes, DTOs, auth, error shapes -> docs/spec/06_API_CONTRACTS.md; security model -> docs/spec/07_SECURITY_OPERATIONS.md.
- New behavior/test risks -> docs/spec/08_TESTS_AND_ACCEPTANCE.md.
- Agent workflow -> AGENTS.md, docs/spec/10_CODEX_ORCHESTRATION.md, skills/README.md.
- Task sequencing -> docs/spec/09_ROADMAP_BACKLOG.md, task checkpoint (if active).

Change the **smallest existing section** and avoid appending contradictory duplicates. If actual implementation conflicts with an approved decision, report DOC_CONFLICT rather than rewriting source of truth to match code.

## Output
DOCS_IMPACT: YES|NO; AFFECTED_FILES with exact reason; APPROVAL_NEEDED; DOC_CONFLICTS; NEXT_ACTION.
