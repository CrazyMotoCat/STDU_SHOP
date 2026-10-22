# R1-002B

TASK: R1-002B
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: B1 — Prisma schema and first isolated PostgreSQL migration slice
UPDATED_AT: 2026-10-22
BRANCH: codex/r1-002b-staff-identity
LAST_SAFE_COMMIT: 9dad7297603460b835a76a2147d1fcf9bac96d03
OWNER_APPROVED_SOURCE_SHA: 867184f60d5306b58dd66ac6607a6ec0487761d3
FROZEN_CONTRACT_COMMIT: bf0b66d06cca7a061c35d3f9e7af9a99f5f5ea57
CONTRACT_VERSION: 1.0.0

## COMPLETED

- Start assignment docs/plans/R1-002B-start.md prepared against approved11 models/12 actions/23 operations/40 future tests, existing bounded implementation plan.
- Owner authorization: B AUTO_MERGE within frozen decisions, mandatory independent security/database review and actual runtime tests. Production migration/deploy NOT authorized.

## VERIFIED

- A PR4 merged; current fetched baseline main/origin/main is 9dad7297603460b835a76a2147d1fcf9bac96d03.
- Frozen checker `node docs/contracts/check-R1-002.mjs` PASS at task start.
- Feature branch `codex/r1-002b-staff-identity` created from synchronized, clean baseline.
- Docker Engine is available. Existing Docker containers belong to another project and are left untouched; B will use an isolated test database/container.

## OWNERSHIP / LIMITS

One lead writer for DB/schema/migrations/OpenAPI/permissions. Contract changes require owner decision; no parallel edits of frozen artifacts. No secrets/default accounts, user-volume reset, production or R1-003.

## UNCOMMITTED

No implementation changes yet. Registry compatibility was checked for Prisma 7.10.1, Prisma PG adapter 7.10.1, and argon2 0.45.1 / Node >=16.17.

## BLOCKERS

None for approved B start. Live B security/DB correctness remains unverified until implementation/tests/reviews.

## NEXT_ACTION

Implement the frozen 11-model schema and first migration, then apply and test it against an isolated ephemeral PostgreSQL instance without touching existing containers, volumes, or databases.

## DO_NOT_REPEAT

Do not redesign FROZEN1.0.0, re-open approved OD01..08 without concrete contradiction, claim foundation tests prove B, implement forbidden R1 domains or run production migrations/deploy.
