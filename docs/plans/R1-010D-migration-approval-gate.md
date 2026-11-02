# R1-010D scan migration approval gate

Status: TARGETED_FIX / REVIEW_REQUIRED. No merge or production authorization.

## Default deployment

`pnpm db:migrate:deploy` and direct `prisma migrate deploy` with the default config apply only `apps/api/prisma/migrations`. The scan migration resides in `apps/api/prisma/scan-migrations`, outside the discovery path. A refusal is not implemented by throwing inside a pending migration: ordinary deploy therefore does not create a FAILED scan-history row. Ordinary future reviewed SQL migrations remain discoverable and deployable.

**Migration authoring limitation:** default `pnpm db:migrate:dev` / direct default `prisma migrate dev` now fail before shadow diffing. The runtime schema includes the isolated scan model; automatic generation from the reduced history could reintroduce scan objects into ordinary migrations. Automatic authoring requires a separately reviewed schema/history authoring plan. This gate does not provide such a plan or silently authorize scan deployment. Existing reviewed ordinary SQL migrations can still be deployed normally.

## Explicit disposable-only application

The dedicated Node entry point is `apps/api/scripts/deploy-scan-migration.mjs`. Set all of these explicitly in the caller environment:

- `MIGRATION_DATABASE_URL`: the owned disposable database connection.
- `STDU_SCAN_MIGRATION_APPROVAL=R1-010D-DISPOSABLE-ONLY`.
- `STDU_SCAN_MIGRATION_TARGET`: the exact database name, either `stdu_r1_010d_test` or `stdu_scan_gate_[a-z0-9_]+`.

Invoke `node apps/api/scripts/deploy-scan-migration.mjs` from the repository. No production application is supported. CI, NODE_ENV, APP_ENV and ordinary deployment do not issue approval. The R1-010D test harness explicitly supplies approval only to this invocation.

The helper rejects absent intent, disallowed target and URL/target mismatch before Prisma. It then reads PostgreSQL `current_database()` and compares the actual SQL target. Only then does it build a temporary merged directory of ordinary plus scan migrations and execute pinned Prisma migrate deploy. Temporary files are removed. This is operator-intent and target verification, not cryptographic authorization against a migration administrator. Privileged raw SQL or a deliberately custom Prisma config can bypass client policy; that authority is outside this gate.

## SQL and migration history

The original SQL remains byte-identical, moved without editing. Git blob: `71903fa7b1770f03afdd88225e3f4a0506281625`; SHA256: `05d42564dd8389c0b4422cdf57a3e2ceb3abba45d9892c4a89fdddc338ce1e0c`.

An in-migration SQL guard was considered and not selected: changing already-applied SQL would change its recorded checksum. The isolated Prisma7.10.1 experiment also demonstrated that migrate deploy does not itself reject an edited applied checksum. No history rows are rewritten or resolved automatically. Preflight target verification is SQL, but is **not** an in-migration SQL guard.

The proof experiment verified: reduced history before scan, full historical scan application, reduced history after scan, future ordinary migration, and unchanged successful history. Its temporary modified-checksum copy was an experiment only; repository SQL was never modified.

Dedicated acceptance: `node apps/api/scripts/check-scan-migration-gate.mjs`. It creates its own labelled PostgreSQL container and persistent disposable volume; verifies actual root package deploy, direct Prisma, objects/procedures/trigger/roles absent, no scan or FAILED history, expected approval refusals, explicit apply, repeated deploy, database restart, preserved exact checksum/history, and a future ordinary migration. Container and volume ownership are checked before cleanup. Full R1-010D separately verifies actual QUARANTINED backfill and exclusion of terminal documents using the dedicated approved entry point.

L0, API/FROZEN artifacts, worker/scanner behavior and production state are unchanged. No production credentials, files, DB or inventory are used.
