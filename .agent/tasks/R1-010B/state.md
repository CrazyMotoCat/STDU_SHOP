# R1-010B task state

TASK: R1-010B Public Inquiry Backend & Staff Workflow
STATUS: IN_PROGRESS
DELIVERY_MODE: AUTO_MERGE
CHECKPOINT_STATUS: SAFE
PHASE: isolated Compose overlay fixed; exact implementation-head CI passed; syncing checkpoint before PR integration
UPDATED_AT: 2026-10-27
CONTRACT_APPROVED_SOURCE_SHA: 68fb60f87c7821044939dd5d95f8e67e6bb73685
CONTRACT_APPROVAL: OD-010-01…05 approved; FROZEN 1.0.0 integrated
CONTRACT_MERGE_SHA: c8b10f07522d0d72bd52834607e154abbd0c28c6
BASE_MAIN_SHA: 27f3e99b616b44592957f50d13df412d7cf8e953
CURRENT_BRANCH: codex/r1-010b-inquiry-impl
CURRENT_HEAD: task branch tip; verify with `git rev-parse HEAD`
CURRENT_WORKTREE_STATE: implementation and isolated Compose fix are committed on the task branch; only unrelated generated R1-003/R1-005V artifacts remain untracked and excluded.
ORIGIN_MAIN: 27f3e99b616b44592957f50d13df412d7cf8e953 (freshly fetched; synchronized at checkpoint)
PR: Draft #24 https://github.com/CrazyMotoCat/STDU_SHOP/pull/24
EXACT_HEAD_CI: run 40494617768 SUCCESS on implementation SHA `4ddee85a2a8c998b4e20d1a4c824ec612e4baadd`. The earlier `40493633373` failure was caused by `compose.test.yaml` clearing top-level named volumes but leaving the base Redis `redis-data` mount. The fix replaces only isolated Redis `/data` with tmpfs; ordinary Compose named storage is unchanged. Targeted Compose config, format check and diff check pass. Local full smoke was not run because the shared existing project occupies required host ports; CI completed five-service and three consecutive host smokes.

## Completed implementation scope

- Added six Inquiry domain entities with additive migration and restrictive relations, lifecycle constraints, runtime-role grants, revocable one-way upload capability and audit/idempotency persistence.
- Implemented anonymous inquiry creation, capability-only upload intents, streamed CSV/PDF/XLSX intake, private quarantine and CLEAN-only download boundary, source/file limits, durable idempotency, rate limiting and sanitized errors.
- Implemented staff list/detail/history, assignment, typed pre-quote closure, stage deadlines, comments, OCC, audit and field-level redaction under R1-002 permissions.
- Added staff inquiry list/detail screens; public inquiry form remains disabled pending legal approval.
- Added generated Inquiry OpenAPI export/checker, frontend route metadata and disposable PostgreSQL/Redis runtime harness.
- Redis source/day quota state is configured for AOF persistence in the main Compose profile; source quota uses a source-wide DB advisory lock and reads the UTC date from PostgreSQL only after lock acquisition.
- PDF structural scanning is limited to PDF candidates with bounded retained data; failed exact-object cleanup emits a sanitized diagnostic and leaves any orphan private for the ownership-checked sweeper.
- OpenAPI 3.1 export converts runtime nullable schemas to JSON Schema null unions and the checker verifies required nullability.
- Frozen R1-002/R1-004/R1-006/R1-007/R1-010 contracts and business decisions #1–108 were not edited.

## Fresh local verification (2026-10-27)

- PASS `pnpm toolchain:check` (Node 24.19.0, pnpm 11.25.0, Python 3.14.3, uv 0.13.3).
- PASS `pnpm db:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `git diff --check`.
- PASS `pnpm contract:check`; PASS `pnpm contract:test` (10/10); PASS `pnpm inquiry:contract:check` (OpenAPI validation and 15 operations).
- PASS `pnpm test`: 68 Vitest passed, 88 skipped; ingestion pytest 15/15 passed.
- PASS `pnpm test:r1-010b`: 34/34 on owned disposable PostgreSQL/Redis. Includes exact upload-intent replay without internal quota metadata leakage; cross-source retry after transaction rollback charges only the committed reservation; UTC rollover lock ordering; AOF-backed Redis restart persistence; upload structure/memory-spam fixture; expired/backdated receiving SQL guard; capability revocation; storage cleanup diagnostic; staff scope/assignment races; and quarantine/download checks.
- The first hosted run `40492808737` passed all 34 Inquiry runtime tests, then failed while removing Redis AOF files owned by container root (`EACCES` on the isolated test directory). The harness now runs disposable Redis as the invoking UID/GID on Unix, uses the Windows-compatible root fallback, and reports owned-directory cleanup failures explicitly. Fresh Windows rerun passed 34/34 and exited 0 after cleanup.
- The next hosted run `40493633373` passed all Inquiry runtime tests and the R1-002B/R1-006B/R1-007B/R1-003/R1-005 acceptance suites, then failed before integration smoke: `compose.test.yaml` set top-level `volumes: !override {}` while retaining Redis's base named-volume mount. The isolated overlay now gives Redis a tmpfs `/data`, matching its no-named-volumes policy; targeted config and final implementation-head CI subsequently passed.
- PASS targeted Compose `config --quiet` with base, test and host overlays; rendered model confirms Redis `/data` is tmpfs and has no named-volume mounts. PASS `pnpm format:check` and `git diff --check`. Local full smoke was skipped because the shared development Compose stack holds ports 3000/3001/15432/16379; it was not stopped or modified.
- Final implementation-head hosted CI run `40494617768` on `4ddee85a2a8c998b4e20d1a4c824ec612e4baadd`: SUCCESS. All quality/contract/runtime/UI checks, five-service integration smoke, three consecutive host lifecycle smokes, and stopped-state restoration passed; named volumes were not deleted.
- PASS `pnpm test:r1-006b` (disposable migration/runtime harness; database sentinel preserved).
- PASS `pnpm test:r1-007b`: 11/11; disposable database sentinel preserved.
- PASS `pnpm test:r1-002b`: 26 passed, 1 loopback browser smoke skipped because ports 3000/3001 are already occupied; existing processes were left untouched; post-runtime sentinel unchanged.
- BLOCKED-LOCAL-CONFIG `docker compose -f infra/compose/compose.yaml config --quiet`: main Compose requires local `.env` values. No `.env` was generated and no secrets were invented. Disposable R1-010B Compose was started successfully by its runtime harness.
- Required local checks rerun after final code/test updates: lint, format check, typecheck, build, unit/pytest, contract check/test, Inquiry OpenAPI validation and generated TypeScript reproducibility, database validation, `git diff --check`, and the 34-case disposable Inquiry runtime suite.
- Push the test-harness cleanup fix and verify a new GitHub Actions run on its exact SHA before merge.

## Independent reviews

- Backend review: PASS on scope/privacy, UTC ordering, OpenAPI nullability and final quota-receipt persistence/replay. Exact upload-intent replay is covered and the internal quota wrapper is not returned publicly. Nonblocking checker caveats: frozen response/parameter metadata is overlaid in the generated export, and nullability assertions cover selected fields.
- Database review: PASS on exact quota-ticket identity binding in rollback settlement and stale reconciliation. The runtime regression holds failed-request settlement until a same-key retry from a second source commits, then verifies only the committed source/day ticket remains charged. Earlier expired/backdated RECEIVING trigger guard remains covered by PostgreSQL runtime tests.
- Security review: PASS on the frozen 1 MiB per-stream application-buffer budget. Both Transform queues are 128 KiB; conservative accounting totals 824 KiB, with 200 KiB headroom. Structural PDF/XLSX checks are not full format parsers; files remain QUARANTINED without a configured scanner.

## Contract and delivery boundaries

- Six approved Inquiry tables, 15 Inquiry API operations, nine additive default-deny permissions and REQB-01…41.
- Public request creation remains disabled outside development until legal approval. No production PII collection, production migration, deployment, permission grant, scanner provisioning or public launch was performed.
- No order, warehouse, production workflow, quote calculation, quote creation, outbound notification, OCR or automatic catalogue matching was added.
- Use only the explicit task-owned file list when staging. Never stage `artifacts/verification/R1-003/*` or `artifacts/verification/R1-005V-01/*`; those are unrelated user artifacts.
- Local checks and independent reviews are complete. Publish the task branch, create/attach the Draft PR, verify checks on exact PR HEAD, and follow AUTO_MERGE only after all policy gates pass. No production migration/deployment.
