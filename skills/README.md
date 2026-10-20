# Codex skills — STDU_SHOP R1

Adapted selectively from [AC_Expluatation](https://github.com/CrazyMotoCat/AC_Expluatation/tree/main/skills). These are repository-local workflows, not additional business requirements. They do not authorize a new feature, third-party service, destructive action or a merge.

## Dispatch, only as needed

| Situation | Skills |
| --- | --- |
| Any multi-file or quota-sensitive task | efficient-orchestrator |
| Big change, migration, parallel writers, or recovery | repository-state-guard |
| Need 2+ independent implementation streams | task-decomposer |
| Pause or context/usage handoff | task-checkpoint |
| Continue existing R1 task | task-resume |
| Multiple writers / high-risk review | multi-agent-review |
| Business/auth/API/schema changed | traceability-checker and docs-impact |

Keep tiny changes simple. Never invoke all skills merely because they exist. Skills run in the agent's ordinary repo context: read the requested SKILL.md and follow it; a Codex skill loader, if present, may also discover them.

## Safe sequence for R1 high-risk work

repository-state-guard -> efficient-orchestrator -> freeze contract -> (task-decomposer if useful) -> implementation in isolated ownership -> targeted checks -> independent multi-agent-review if needed -> traceability-checker -> docs-impact -> task-checkpoint -> PR.

## Sources of truth

User-approved decisions 1–108 and R1 release boundaries supersede these workflow procedures. See AGENTS.md and docs/spec/00_README.md. Never reproduce the AC_Expluatation equipment/site/CMMS RBAC and maintenance rules in STDU_SHOP.

## Task state

Use .agent/tasks/R1-###/state.md from skills/_templates/task-state.template.md. Optional per-agent notes go into .agent/tasks/R1-###/agents/<agent-id>.md from agent-state.template.md. Do not commit credentials or private specifications to task notes. Checkpoint status is verified against the actual Git state and recorded check output.
