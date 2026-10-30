# R1-010D task state

TASK: R1-010D Malware Scanning & Quarantine Processing
STATUS: STAGE_B_IMPLEMENTATION_IN_PROGRESS
DELIVERY_MODE: REVIEW_REQUIRED
PHASE: STAGE_B_VERTICAL_SLICES
UPDATED_AT: 2026-10-28
STAGE_A_BRANCH: codex/r1-010d-contract-proposal
STAGE_A_APPROVAL_SOURCE_HEAD: 1cad9fbb210ded32b07cee3923bec8ab011768a8
STAGE_A_BASE_MAIN_SHA: 2e5b59fc0d99e3580bbdaa6665df335192f83cbe
STAGE_A_FINAL_HEAD: cb2de31e3a824e85304296d67c9a77a9aa36fd9a
STAGE_A_MERGE_SHA: 55281be07e8d6938c8b1a6ba6988e188b7fc642b
STAGE_A_REQUIRED_PR_CI: SUCCESS / run 40668931143
STAGE_A_POST_MERGE_CI: IN_PROGRESS / run 40669934548
STAGE_B_BRANCH: codex/r1-010d-stage-b
STAGE_B_BASE_MAIN_SHA: 55281be07e8d6938c8b1a6ba6988e188b7fc642b

## Owner-approved scope

- ADR-005 option B and OD-010D-01…05 approved for isolated Stage B implementation.
- Clarifications A–D are frozen in `docs/contracts/R1-010D-malware-scan-contract.md` version 1.0.0.
- The additive migration backfills exactly existing QUARANTINED sources transactionally and idempotently, copying immutable storage key/hash/size; terminal source rows are excluded.
- Operator retry requires an audit correlation ID and is enabled only for the isolated test profile until a separate production-attribution decision.
- Scanner readiness and loaded engine/signature metadata are attested before and after scanning; any discontinuity or uncertainty fails closed.
- Finalize no-write replay requires the same authorized worker, completed job version, lease-token hash and canonical result fingerprint.
- Existing FROZEN R1-010 1.0.2, other frozen contracts, business decisions 1–108 and public API remain unchanged.
- Stage A does not authorize production migration/deployment, real-document processing, production operator retry, public launch or production permission grants.

## Completed

- Reconciled PR #25 and current `origin/main`; PR #25 is merged at `2e5b59fc0d99e3580bbdaa6665df335192f83cbe`.
- Safely merged the fresh `origin/main` into the PR #26 branch; R1-010C files were integrated by Git and its worktree was not modified.
- Promoted the approved security proposal into a frozen additive contract and accepted ADR-005 option B.
- Added a frozen manifest with approval provenance, source checksums and final contract checksums.
- Added `r1-010d:contract:check` and `r1-010d:contract:test` to local scripts and mandatory CI.

## Stage A verification

- `pnpm r1-010d:contract:check`: PASS.
- `pnpm r1-010d:contract:test`: PASS, 6/6.
- `git diff --check`: PASS.
- Node warning: repository expects 24.19.0; local shell provides 24.22.1.
- PR #26 is merged; exact PR-head and post-merge checks are tracked above.
- Local Docker Desktop is unavailable (`docker info` cannot connect to the Docker API); hosted CI is the available Compose runtime for exact scanner tests.

## Files changed in Stage A

- `docs/adr/ADR-005-malware-scanning.md`
- `docs/contracts/R1-010D-malware-scan-contract.md`
- `docs/contracts/R1-010D-frozen-manifest.json`
- `docs/contracts/check-R1-010D.mjs`
- `docs/contracts/check-R1-010D.test.mjs`
- `docs/spec/09_ROADMAP_BACKLOG.md`
- `package.json`
- `.github/workflows/ci.yml`
- `.agent/tasks/R1-010D/state.md`

## Stage A delivery

- Stage A was pushed to PR #26, marked Ready, and merged under normal repository rules at `55281be07e8d6938c8b1a6ba6988e188b7fc642b`.
- Local `main` was fast-forwarded to the merge SHA in its clean, dedicated worktree.
- A separate Stage B worktree was created from the exact `main` merge SHA; R1-010C worktrees remain untouched.

## Stage B implementation plan

1. Add the additive PostgreSQL model/migration, transactional legacy-Q backfill, four hardened procedures, and disposable role/grant tests.
2. Create scan jobs in the successful upload transaction; add a lease-authorized private byte-stream server that opens originals only in the API/storage process.
3. Implement clamd INSTREAM with backpressure, absolute deadlines, hash/size verification, start/end VERSION attestation, fail-closed result classification, atomic finalize/audit and exact replay fencing.
4. Add isolated scanner worker and test-only operator retry, readiness/metrics/sanitized diagnostics, digest-pinned isolated Compose and generated-fixture runtime harness.
5. Run the R1-010B regressions, SCAN-01…20, real clamd/EICAR tests, quality gate and exact-HEAD CI; obtain independent backend/database/security/DevOps reviews.
6. Create a Draft Stage B PR and stop at engineering acceptance. No Stage B merge or production operation.

## Stage B gates

- Implement the approved one-table/four-procedure design; no new public route or business permission.
- Run generated-file HTTP/DB runtime tests and real-clamd smoke; mocks alone are insufficient.
- Complete SCAN-01…20, existing R1-010B regression, quality gate, independent backend/database/security/DevOps reviews, exact-HEAD CI and resource measurements.
- No production migration, deployment, real customer documents or production operator retry.

## Do not repeat / protect

- Do not edit or clean the R1-010C worktree, shared project containers or shared Docker volumes.
- Do not report Stage B accepted until the exact CI/reviews/runtime evidence exists.
- Do not invoke production migration, deployment, public launch or real operator retry.

## Stage B checkpoint — paused by owner

TASK: R1-010D Malware Scanning & Quarantine Processing
STATUS: PAUSED_FOR_OWNER / ENGINEERING_ACCEPTANCE_PENDING
DELIVERY_MODE: REVIEW_REQUIRED
PHASE: FINAL_REVIEW_FINDING_BEFORE_DRAFT_PR
UPDATED_AT: 2026-10-29
CHECKPOINT_STATUS: SAFE_WITH_UNCOMMITTED_WORK
LAST_SAFE_COMMIT: 55281be07e8d6938c8b1a6ba6988e188b7fc642b
BRANCH: codex/r1-010d-stage-b
BASE: origin/main at 55281be07e8d6938c8b1a6ba6988e188b7fc642b
HEAD: 55281be07e8d6938c8b1a6ba6988e188b7fc642b (Stage B work is uncommitted)

### Stage B completed in the worktree

- Added the additive `InquirySourceDocumentScanJob` model/migration, transaction-safe quarantine backfill and four restricted scan procedures; no production database was touched.
- Added the lease-authorized API/storage byte stream and isolated NestJS scan worker with ClamAV INSTREAM, backpressure, bounded deadlines, SHA-256/size verification, signature attestation, fail-closed outcomes, transactional audit/finalize, retries and exact replay fencing.
- Added protocol/storage/runtime regression tests, separate production deploy build stage, CI commands and a disposable isolated Compose runtime harness.
- Corrected the test-only ClamAV startup ordering: FreshClam updates the task-owned seed before the signature volume is copied and clamd starts. Only the updater/ClamAV scanner receive signature egress; application/API/PostgreSQL/worker/test runner remain on their intended isolated networks.
- Runtime harness now prints Vitest summaries. It uses unique project labels and removes only its own test containers, networks and volumes. Latest R1-010D runtime completed and cleaned its project successfully.
- Frozen R1-010D/R1-010B contracts, public API, production deployment state and permissions remain unchanged.

### Verification actually completed

- `pnpm r1-010d:contract:check`: PASS.
- `pnpm r1-010d:contract:test`: PASS, 6/6.
- `pnpm db:validate` with disposable local `MIGRATION_DATABASE_URL`: PASS.
- `pnpm lint`: PASS.
- `pnpm format:check`: PASS.
- `pnpm typecheck`: PASS (API, web, staff client and Python mypy checks).
- `pnpm test`: PASS, 101 Vitest passed / 99 skipped; 15 pytest passed.
- `pnpm build`: PASS (API, web, staff client and Python wheel/sdist).
- `pnpm test:r1-010b`: PASS, 34/34 Inquiry runtime tests.
- Latest `pnpm test:r1-010d`: PASS, isolated PostgreSQL/HTTP/real ClamAV run. Runtime phase totals: 2 upload-profile checks, 4 DB checks, offline, hard-timeout prep/verify, worker-restart prep/verify, and real final scan; 12 phase checks passed. Final scan accepted generated clean files, rejected EICAR and denied rejected-file download. Sampled ClamAV peak was about 963 MiB of its 6 GiB container cap; no resource cap was exceeded. See untracked local evidence `.agent/tasks/R1-010D/runtime-local-8.log` and `.agent/tasks/R1-010D/runtime-r1-010b-regression.log`.
- `git diff --check`: PASS before the final lint-only edits; rerun before commit.
- Local host Node is 24.22.1 while repository pins 24.19.0. GitHub CI has not been started for Stage B; it must run on the exact pushed PR SHA. No Stage B commit, push, PR or merge exists yet.

### Independent reviews and open finding

- Backend/security review: no BLOCKER/HIGH; one MEDIUM remains. The worker readiness attests PostgreSQL and clamd PING/VERSION/signature freshness but does not verify the frozen contract’s ClamAV scratch-capacity and cgroup OOM readiness conditions.
- Database review: PASS, no actionable findings.
- DevOps review: PASS for the isolated FreshClam seed, egress boundaries, and test-summary reporting; static only.
- Next action: resolve the MEDIUM by adding a ClamAV container healthcheck for available `/tmp` capacity and zero cgroup OOM counters, assert the scratch budget in the runtime harness, then rerun affected checks and R1-010D runtime. Do not add Docker-socket access or a new service. After the independent review is clear, run final `git diff --check`, inspect task-owned staging, commit/push, open a Draft PR, and verify exact-HEAD GitHub CI. Stop at engineering acceptance; do not merge or perform production operations.

### Expected uncommitted paths

- Modified: `.agent/tasks/R1-010D/state.md`, `.github/workflows/ci.yml`, `apps/api/Dockerfile`, `apps/api/prisma/schema.prisma`, `apps/api/src/database/database.module.ts`, `apps/api/src/inquiries/inquiries.module.ts`, `apps/api/src/storage/private-file-storage.ts`, `package.json`.
- Added: `apps/api/prisma/migrations/20261028120000_inquiry_scan_jobs/migration.sql`, `apps/api/scripts/deploy-pre-scan-migrations.mjs`, `apps/api/scripts/run-r1-010d-runtime.mjs`, `apps/api/src/inquiries/response-lifecycle.ts`, `apps/api/src/inquiries/scan-protocol.ts`, `apps/api/src/inquiries/scan-stream.server.ts`, `apps/api/src/scan-worker/*`, `apps/api/test/r1-010d.*.test.ts`, `infra/compose/compose.r1-010d-test.yaml`.
- Task-owned untracked local run logs are preserved for resumption and must not be included in the PR.
- Do not touch or clean the R1-010C worktree, any other project, or shared Compose resources.

### Resume inspection — 2026-10-29

- Fetched origin: `origin/main` and Stage B HEAD remain `55281be07e8d6938c8b1a6ba6988e188b7fc642b`; expected Stage B files and local evidence remain uncommitted.
- `pnpm r1-010d:contract:check`: PASS on resume. Docker reports cgroup v2. A disposable inspection of the pinned ClamAV image exposed `memory.events.local`, with zero counters; this is an inspection container, not evidence about a running scanner.
- The image's `clamd.conf` leaves `TemporaryDirectory` commented; its comment says the default is system specific. The actual clamd scratch path must therefore be made explicit or proven on the running scanner before measuring it.
- The current worker attests clamd directly and cannot see scanner-container scratch or cgroup counters. Merely adding a Docker healthcheck would not stop the worker from accepting CLEAN after a resource gate failure. A trustworthy bounded resource-readiness signal must reach the worker at both attestation boundaries while preserving the frozen architecture and fail-closed behavior. This issue remains open; no readiness implementation or new verification is claimed.

### P2 readiness implementation started

- Owner authorized an internal resource probe in the ClamAV container and worker checks before scan and before finalize; see attachment `f94064bc-7d7e-4f69-84e3-99d85d8f915a`.
- Set `CLAMD_CONF_TemporaryDirectory: /tmp` in the isolated test Compose, matching its existing 512 MiB tmpfs. `docker compose -f infra/compose/compose.r1-010d-test.yaml config --no-interpolate --quiet` passed. This confirms Compose syntax only; clamd's loaded configuration, effective mount and runtime access remain unverified after the edit.
- The pinned image inspection showed no Python, Node or BusyBox httpd; a bounded probe needs an appropriate reproducibly built executable or another verified minimal mechanism. No probe, worker integration, RSC tests, independent final review, commit, PR or new CI exists yet. The P2 remains open and CLEAN must not be represented as resource-attested.

### Go resource probe progress — 2026-10-29

- Implemented a static Go probe in `infra/scan-resource-probe/`, built from the digest-pinned Go image into a derivative of the existing pinned ClamAV image. The scanner's loaded configuration explicitly sets `TemporaryDirectory /tmp`; the isolated Compose uses a 512 MiB tmpfs and private cgroup v2 namespace. The unprivileged probe binds only the scanner-internal address. The pinned ClamAV init script is run under tini with group signal forwarding.
- The worker and its healthcheck now require fresh resource snapshots, with bounded response size and deadline. The scan compares probe/scanner identity at both boundaries before CLEAN/REJECTED. Unsupported cgroups and failed resource measurements are fail-closed.
- Actual disposable runtime confirmed the probe responds READY in the scanner container, `/tmp` is the configured 512 MiB tmpfs, and `memory.events.local` reported zero `oom` and `oom_kill`. `pnpm test:r1-010d` passed its existing phases with the Go probe; its final real ClamAV scan accepted clean fixtures and rejected EICAR. A subsequent isolated fault-injection run passed the PostgreSQL assertion that probe failure after a fake clamd OK results in SCAN_ERROR and a FAILURE audit. The final cleanup of that run was still in progress when recorded.
- Go unit tests for scratch boundaries and OOM counter parsing passed; `pnpm exec vitest run apps/api/test/r1-010d.resource-readiness.test.ts` passed 11 tests. Targeted ESLint and API typecheck passed before the final test-only harness edits. A failed earlier Node-probe experiment is not evidence for the Go implementation.
- RSC-01…18 and SCAN-01…20 evidence matrix, full quality gate, fresh independent review, commit/push, Draft PR and exact-HEAD CI remain outstanding. P2 remains open until all required negative tests and review pass. `FRESHCLAM_CHECKS=24` was added after the latest runtime image was built and requires verification in the next run.

### Draft PR and follow-up verification

- Draft PR #28 was opened at `17e78a0db748f74029864c76d2f4957304ef6b8a`. Its CI run 40874413215 failed at the R1-004B catalog migration harness because scanner roles are PostgreSQL cluster-wide and the harness deploys into two databases in one disposable cluster. The R1-004B and R1-002B harnesses were updated to use pre-scan migrations in their additional databases; the R1-010D runtime independently applies and tests the full scanner migration. Both affected runtime harnesses passed locally; R1-002B reported 26 passed and one browser test skipped because ports 3000/3001 were occupied.
- Latest `pnpm test:r1-010d` completed successfully using the Go probe in project `stdu-r1-010d-test-18280-feb965a0`, including real clamd/EICAR, healthy-but-probe-unavailable recovery, and PostgreSQL/audit assertions for eleven controlled resource failure modes. Exact task-owned containers and volumes were absent after cleanup. Evidence: untracked `runtime-resource-matrix-final5.log`.
- Go probe tests, targeted ESLint, API typecheck and the focused 33 Vitest protocol/storage/resource tests passed. Earlier full local gate passed after the probe implementation, but must be rerun or assessed against any subsequent code change. The evidence matrix is `verification-matrix.md` and explicitly marks remaining gaps.
- Scanner readiness implementation requires fresh independent backend/security and DevOps review. SCAN-09 has a real archive-depth limit fixture and simulated limit classifications; individual real file-count and scan-time limit evidence remains incomplete. Do not report final engineering acceptance until the remaining evidence, reviews and CI for the final pushed HEAD are resolved.

### Independent review follow-up — 2026-10-29

- Draft PR #28 HEAD `99429b36cf598fb4e1a769a05a396b4753bab144`; CI run 40878689313 started for this SHA. The old migration harness failure is fixed and its corresponding step passed on the new run; full CI remains pending.
- Fresh independent DevOps review found no P0/P1/P2 in the resource probe and Compose, but did not find a dedicated graceful SIGTERM/orphan test.
- Fresh independent security review found P1: FROZEN section 4.3 requires an equivalent OLE2 fixture on the exact pinned image before XLSX CLEAN; existing runtime proves ordinary XLSX and recursion only, and the worker currently accepts `stream: OK` as CLEAN. Section 4.2 additionally requires evidence for individual real file-count, size, scan-time, encrypted and PCRE behavior. No silent scan failure has been reproduced. Close this with exact-engine tests and the required fail-closed gate where applicable, followed by independent re-review. The previous preliminary no-P1 conclusion was withdrawn.
- This is an open, unmerged Draft PR. Do not report engineering acceptance or perform production operations. PR description records the finding independently of this checkpoint.
- A subsequent disposable `pnpm test:r1-010d` with a nested archive containing 10,100 generated entries passed: real ClamAV produced SCAN_ERROR with SCAN_LIMIT_EXCEEDED and the PostgreSQL/audit assertions passed. The exact alert has not yet been established. This test remains uncommitted. An OLE2/XZ equivalent fixture and XZ limit classification fix were then added.
- CI 40878689313 completed SUCCESS on published `99429b36cf598fb4e1a769a05a396b4753bab144`. It predates the following local changes and is not evidence for their eventual commit.
- `runtime-ole-limit-2.log`: PASS on disposable PostgreSQL and real pinned ClamAV with nested OLE2 Workbook/XZ fixture; database state and audit reported SCAN_ERROR / SCAN_LIMIT_EXCEEDED. The XZ dictionary limit is now explicitly classified as incomplete. Security re-review and the remaining size/time/encrypted/PCRE proofs are pending. The earlier `runtime-ole-limit.log` failed at create rate limiting; fixtures were consolidated into an existing inquiry without changing application rate limits.
- Security re-review requires checking the exact scanner alert and a control OLE2 with normal XZ/EICAR; the common SCAN_LIMIT_EXCEEDED code alone does not prove which nested limit fired. A generated-only direct clamd assertion was added and is pending runtime. One intervening local run failed before tests because its reserved disposable Docker subnet overlapped a concurrently created network; no foreign networks were modified.
- `runtime-exact-clamd.log`: PASS, including exact `Heuristics.XZ.DicSizeLimit`, EICAR control, and `Heuristics.Limits.Exceeded.MaxFiles` on pinned ClamAV and the pipeline's DB/audit checks. Independent security re-review confirms the OLE2 finding closed; exact MaxFileSize, MaxScanSize, MaxScanTime and PCRE remain an acceptance blocker under section 4.2. These newer changes are not yet pushed or CI-verified.
- P1 reproduced in `runtime-exact-size.log`: pinned clamd returned `stream: OK` for a synthetic XLSX containing a 64 MiB + 1-byte expanded entry under configured MaxFileSize=64 MiB and AlertExceedsMax=yes. The source was synthetic and below upload-size limits. This proves missing required limit signal, not by itself which bytes were examined. A below/above-limit embedded EICAR control is running in `runtime-size-eicar.log`. Security review reports the current CLEAN mapping as unsafe until a fail-closed gate or reliable complete scanning is established. Do not merge or claim completion.
- The embedded-EICAR control did not establish byte-level skipping: both a 64 MiB - 1 and a 1 MiB control returned OK (`runtime-size-eicar.log`, `runtime-size-eicar-control.log`); the test stopped before the oversized EICAR case. The small control is unsuitable or requires further investigation. Do not claim the engine skipped EICAR. The exact-size experimental fixture currently makes the local runtime command fail intentionally; changes in the worktree are WIP and not on the published PR HEAD.

### Security P1 emergency completeness gate — 2026-10-30

- Resume state: expected task-owned WIP and evidence preserved; published Draft PR #28 HEAD 99429b36cf598fb4e1a769a05a396b4753bab144, prior CI 40878689313 does not cover this change. Current origin/main advanced to 336ec8ed82224748e8d2b76bd9a049ee7fb38fbb; no merge or integration performed.
- The worker now denies CLEAN for all input types pending proof of completeness; this intentionally prevents clean PDF, CSV and XLSX downloads. XZ dictionary limits and unknown heuristic alerts fail closed. This is a security containment, not completed scanner functionality or independent proof.
- Focused protocol tests 20/20, ESLint and Prettier passed. The old experimental size tests remain WIP and are not included in the emergency commit. Real pipeline regression, boundary fixtures, SIGTERM, full gate, exact-head CI and independent security review remain required. No production operation.

### P1 remediation checkpoint — 2026-10-30

STATUS: CHANGES_REQUIRED
LAST_SAFE_COMMIT: 82bf37ad21d2fd8d057106e306e3a32808d92191 (pushed to Draft PR #28)
CURRENT_SCOPE: Universal worker-side CLEAN denial while scan completeness is unproven. PDF, CSV and XLSX safe documents are intentionally unavailable. No production operation or merge.
VERIFIED: protocol/resource tests 31/31; R1-010D frozen contract checker and 6 tests; lint, format:check, typecheck, build; pnpm test 114 passed / 124 skipped and pytest 15 passed; test:r1-010b 34/34 on isolated PostgreSQL/Redis; Go probe tests passed in pinned container. Exact-head GitHub workflow query returned no runs as of this checkpoint, not SUCCESS.
REAL_CLAMD: independent openpyxl 3.1.5 workbook round-trip and zipfile CRC/extraction validated; exact EICAR bytes are present in xl/worksheets/sheet1.xml. Direct EICAR and validated ZIP EICAR returned FOUND, valid XLSX EICAR cell returned stream: OK. See task-owned untracked runtime-valid-xlsx-eicar.log and valid-xlsx-eicar-experiment.py; this is not proof of specific limit triggering or malware exploitability.
REVIEW: independent security reviewer passed current worker containment only, with P1 DB finalizer can accept CLEAN from trusted worker credentials, P1 conditional pre-existing CLEAN reconciliation before rollout, P1 exact-commit runtime assertions stale; P2 failure code maps to generic audit reason. No public bypass identified. Full acceptance not achieved.
UNCOMMITTED: verification-matrix.md, runtime harness and pipeline test changes are task-owned WIP; generated task logs/scripts are untracked and must not be staged as binaries or deleted. A real isolated test:r1-010d is running in project stdu-r1-010d-test-11496-0f859440; inspect its session/log and let its owned cleanup finish. The runner image was built before the final additional download/audit assertions, which therefore need a fresh run.
NEXT: Finish the running test; correct and validate fixture tests without masking missing functionality; prove end-to-end gate/audit and independent security review including DB boundary; run remaining boundary/SIGTERM checks and exact-head CI before reporting readiness.
- Subsequent runtime-p1-remediation.log: test:r1-010d FAILED overall (exit 1): the old 1 MiB embedded-EICAR control expected FOUND but pinned clamd returned stream: OK. Before that, real SCAN_FINAL passed with expected SCAN_ERROR for safe inputs and REJECTED for EICAR; OLE limit, OLE EICAR and MaxFiles exact alerts observed. This does not cover later-added download/audit assertions or the valid-openpyxl XLSX experiment in the pipeline. The disposable runtime cleanup completed; inspect actual container state before further use.

### DB completeness containment — 2026-10-30

- Checkpoint b99f2ae saved previous experimental code before integration. SQL finalize now rejects CLEAN with INQUIRY_SCAN_COMPLETENESS_POLICY_DENIED before job lock and completed replay; worker also logs a static completeness-policy event. No bypass switch or new privileges.
- Disposable PostgreSQL R1_010D_DB_ group: 5 passed, including real worker claim, correctly fingerprinted and attested CLEAN repeated/concurrent denials without state/audit changes, and successful REJECTED using equivalent attestation. Additional replay and download-code assertions were added after the test image was built and require a fresh run.
- The runtime suite continues; inspect runtime-db-policy.log and final exit before claiming overall PASS. Legacy CLEAN production readiness plan is docs/plans/R1-010D-legacy-clean-predeployment.md. Production was not inspected or changed.
- origin/main 336ec8ed82224748e8d2b76bd9a049ee7fb38fbb; merge-tree found only .github/workflows/ci.yml and package.json conflicts. Preserve both R1-010C and R1-010D commands when integrating.
- 2026-10-30 continuation: origin/main integrated in local merge 2e7d821; both R1-010C and R1-010D workflow/package entries preserved. `runtime-db-policy.log` completed PASS with PostgreSQL DB 5/5 and real clamd alerts; `runtime-final-replay.log` passed DB 5/5 with exact-replay, stale lease and runtime/operator checks, and legacy synthetic download (overall run still executing). Valid generated workbook independently passed zipfile CRC/extraction and openpyxl roundtrip, direct pinned clamd returned stream: OK. `runtime-valid-workbook.log` failed 429 in synthetic batch; isolated test Redis intent-hour reset added and `runtime-final-contained.log` is running on the corrected source. No production database or foreign Docker resources modified. SIGTERM, remaining scanner bounds and final exact-head CI/review are pending.
