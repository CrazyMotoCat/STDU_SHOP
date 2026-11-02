# R1-010D targeted migration gate verification

Delivery: TARGETED_FIX / REVIEW_REQUIRED / NO_MERGE / NO_PRODUCTION.
Source PR28 HEAD: b7e048a70b91680203a0917088d87f9fb406c0fc. Main baseline:74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d. Published final SHA and exact-head CI are recorded in PR28 description and owner report after publication; this document does not claim a future CI result.

## Defect and chosen mechanism

The standard Prisma discovery path formerly included scan migration. A comment about production approval had no runtime effect. The fix physically isolates unchanged scan SQL in prisma/scan-migrations; default config discovers only ordinary migrations. A dedicated disposable-only Node procedure requires exact operator intent, allowlisted target name, URL/target equality and SQL current_database equality before invoking Prisma against a temporary combined history. It does not derive approval from CI/NODE_ENV/APP_ENV.

The original SQL SHA256 remains05d42564dd8389c0b4422cdf57a3e2ceb3abba45d9892c4a89fdddc338ce1e0c. No schema, FROZEN artifact, original SQL byte, history row, API, L0, scanner or worker implementation changed. Existing source/audit history remains intact. Migration authoring is fail-closed: default migrate dev is blocked to prevent automatic recreation of scan objects in ordinary history. This is a development workflow limitation requiring a reviewed authoring plan; future approved ordinary SQL deployment remains supported.

SQL in-migration guard was considered, not selected because it would alter an already-applied checksum. Preflight SELECT is SQL target verification, not an in-migration authorization guard. Privileged raw SQL/custom config remains an explicit operator authority; the procedure is not a security boundary against that administrator. Production application is unsupported and unauthorized.

## Experiments before selection

migration-path-probe.log: actual installed Prisma7.10.1 / owned disposable PostgreSQL. Filtered default deploy before scan PASS; full scan deploy PASS; filtered after scan PASS; next ordinary SQL deploy PASS. An experimental temporary copy with changed applied checksum was accepted by deploy, so Prisma deploy alone must not be treated as checksum enforcement. No repository SQL/history was modified by the experiment.

## Fresh checks

| Command / scenario | Result / evidence |
| --- | --- |
| node apps/api/scripts/check-scan-migration-gate.mjs | PASS exit0; migration-gate-runtime-final2.log |
| Actual root pnpm db:migrate:deploy without approval | PASS: ordinary migrations applied, no scan table/roles/procedures/trigger/backfill or history entry |
| Direct default Prisma deploy without approval | PASS; no FAILED history |
| Missing approval / wrong target / CI+NODE_ENV+APP_ENV without approval | Expected pre-Prisma refusals; error text asserted, no objects/history mutation |
| Explicit disposable scan deployment | PASS; exact unchanged checksum in migration history |
| Repeated explicit and normal deploy | PASS; full history unchanged |
| Docker restart on owned persistent volume | PASS; dynamic port refreshed, history/checksum preserved |
| Future ordinary SQL migration after scan | PASS; historical scan row preserved, no history rewrite |
| Default migrate dev | Expected safe refusal before shadow diff |
| R1-002B runtime/migration acceptance | PASS27/27, gate-fix-002b.log |
| R1-004B fixture/migration/HTTP acceptance | PASS including12/12 HTTP checks, gate-fix-004b.log |
| R1-010B runtime | PASS34/34 incl legacy/synthetic CLEAN, RBAC/scope, storage spy and success-audit absence; gate-fix-010b.log |
| R1-010C browser E2E | PASS13 checks incl uploads/privacy/production-off; gate-fix-010c.log |
| R1-010D full runtime | PASS exit0; gate-fix-010d.log; actual migration/backfill uses explicit disposable entry point |
| FROZEN R1-002/004/007/010/010D checkers | PASS; R1-0101.0.3 / R1-010D1.0.1 unchanged |
| R1-010/R1-010D contract tests | PASS40/40, gate-fix-contracts.log |
| Inquiry OpenAPI validation/export/parity and generated TS reproduction | PASS, gate-fix-openapi.log |
| Lint / format / typecheck / build | PASS, gate-fix-*.log |
| Unit tests | PASS150 Vitest /132 optional runtime skips;15 pytest |
| Exact-head hosted CI | Verify after final push; historical source CI41459565465 is not evidence for this patch |

Initial test harness attempts failed due to require path and tmpfs/reconnect fixture bugs; they were corrected rather than treated as passing. The final test uses a labelled, exclusively owned persistent Docker volume and checks labels before cleanup. No shared Docker resources or production systems were modified.

## Independent reviews and P2 disposition

Independent migration_history_review, migration_security_review, migration_devops_review: final targeted-patch PASS, no unresolved P0/P1/P2. Reviewers inspected source and actual test output, did not independently execute Docker acceptance.

P2s found and resolved: restart persistence/port handling; stale R1-002B six-migration expectation; missing actual root-command/procedure/trigger checks; arbitrary-error acceptance; default schema/shadow-diff migration authoring hazard. All corrected and independently re-reviewed. The SQL checksum and every FROZEN artifact are unchanged.

See review-coverage.md for the complete StageB path-group inventory, historical review vs post-L0 reconciliation vs current gate review, and explicit noncoverage. No exhaustive full-StageB security acceptance is claimed.

## Readiness limits

This patch addresses accidental standard migration application. It does not authorize production migration, deployment, inventory, real documents, worker/scanner redesign, CLEAN, eligibility, Ready for Review or merge. Full format completeness, scanner/verifier/storage architecture, real FreshClam upgrade, MaxScanTime/PCRE coverage, external gate/old and mixed versions/rollback and production sizing remain NOT_PROVEN/BLOCKED. A separate owner decision is required for any integration.
Real ClamAV1.4.6/daily28172 preflight age30468s ready=true; SCAN_FINAL, process stop/restart and cleanup completed. Sampled ClamAV peak1851MiB; this is disposable runtime evidence, not production sizing. Synthetic XLSX_EICAR scanner OK remains a known completeness limit; positive CLEAN stays blocked.
