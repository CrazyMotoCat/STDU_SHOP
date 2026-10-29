# R1-010D Stage B verification matrix

This records local evidence, not production readiness. `pipeline` means `apps/api/test/r1-010d.pipeline.runtime.test.ts` executed by `pnpm test:r1-010d` against disposable PostgreSQL and real or explicitly controlled scanner fixtures. `protocol` and `storage` mean the corresponding `r1-010d.*.test.ts` unit suites. Runtime files use generated fixtures.

Draft CI run 40874413215 failed in the catalog migration harness: its two temporary databases share one PostgreSQL cluster, while the scanner migration deliberately reserves cluster-wide role names. The catalog harness now deploys only pre-scan migrations in both catalog databases; the R1-002B harness deploys the full set in its primary database and pre-scan migrations in its separate repeat fixture database. The dedicated R1-010D runtime applies the actual scanner migration and verifies role preflight and quarantine backfill. Both adjusted harnesses passed locally; the R1-002B browser loopback case was skipped because ports 3000/3001 were occupied.

## Frozen SCAN scenarios

| ID | Evidence | State |
| --- | --- | --- |
| SCAN-01 | pipeline `SCAN_FINAL`, generated PDF and real clamd | PASS locally |
| SCAN-02 | pipeline `SCAN_FINAL`, generated CSV and real clamd | PASS locally |
| SCAN-03 | pipeline `SCAN_FINAL`, generated XLSX and real clamd | PASS locally |
| SCAN-04 | pipeline `SCAN_FINAL`, EICAR, PostgreSQL and denied staff download | PASS locally |
| SCAN-05 | pipeline `SCAN_OFFLINE`, no claim while scanner unavailable | PASS locally |
| SCAN-06 | pipeline `SCAN_HARD_TIMEOUT_PREP/VERIFY`, short deadline and fake clamd | PASS locally |
| SCAN-07 | protocol unknown/invalid response fixtures | PASS locally |
| SCAN-08 | protocol truncated input/reply and integrity trailer fixtures | PASS locally |
| SCAN-09 | pipeline real nested XLSX depth limit; protocol classifies limit alerts | PARTIAL: individual real file-count and scanner-time limits not separately demonstrated |
| SCAN-10 | pipeline `UPLOAD` runs for both 10 MiB and 50 MiB profiles | PASS locally |
| SCAN-11 | storage hash/size mismatch and pipeline `DB_SOURCE_MISMATCH_AUDIT` | PASS locally |
| SCAN-12 | pipeline `DB_PROCEDURES`, claim/finalize replay and fencing | PASS locally |
| SCAN-13 | pipeline `DB_PROCEDURES` and `DB_SAME_ROW_LOCK_AND_AUDIT`, PostgreSQL locks | PASS locally |
| SCAN-14 | pipeline `SCAN_RESTART_PREP/VERIFY`, process kill and lease recovery | PASS locally |
| SCAN-15 | pipeline `DB_SAME_ROW_LOCK_AND_AUDIT`, transactional fault injection | PASS locally |
| SCAN-16 | pipeline `DB_ROLE_BOUNDARIES`, restricted roles and procedures | PASS locally |
| SCAN-17 | `pnpm test:r1-010b`, CLEAN download scope and permissions | PASS locally, 34 tests |
| SCAN-18 | `pnpm test:r1-010b` and pipeline `SCAN_FINAL`, download denial | PASS locally |
| SCAN-19 | protocol unsupported/stale version cases and real pinned clamd | PASS locally |
| SCAN-20 | `pnpm test:r1-010b`, capability, upload and replay regressions | PASS locally, 34 tests |

## Resource readiness scenarios

`probe` means Go tests in `infra/scan-resource-probe/main_test.go`; `client` means `apps/api/test/r1-010d.resource-readiness.test.ts`.

| ID | Evidence | State |
| --- | --- | --- |
| RSC-01 | probe scratch/counter tests and real clamd endpoint | PASS locally |
| RSC-02 | probe scratch boundary and pipeline `RESOURCE_scratch_VERIFY` with DB/audit | PASS locally |
| RSC-03 | probe `TestMeasureFailClosed` statfs error; pipeline `RESOURCE_statfs_VERIFY`, simulated probe 503 with DB/audit | PASS locally |
| RSC-04 | probe `TestScratchConfiguration`; pipeline `RESOURCE_config_VERIFY`, simulated probe 503 with DB/audit | PASS locally |
| RSC-05 | probe `TestCounters` and pipeline `RESOURCE_oom_VERIFY` with DB/audit | PASS locally |
| RSC-06 | probe missing local counter test and pipeline `RESOURCE_cgroupmissing_VERIFY`, simulated probe 503 with DB/audit | PASS locally |
| RSC-07 | probe malformed counter test and pipeline `RESOURCE_cgroupmalformed_VERIFY`, simulated probe 503 with DB/audit | PASS locally |
| RSC-08 | client unavailable endpoint and pipeline `RESOURCE_unavailable_VERIFY` with DB/audit | PASS locally |
| RSC-09 | client timeout; pipeline `RESOURCE_timeout_VERIFY` with DB/audit | PASS locally |
| RSC-10 | client stale response; pipeline `RESOURCE_stale_VERIFY` with DB/audit | PASS locally |
| RSC-11 | pipeline `RESOURCE_scratch_VERIFY`, clamd OK followed by inadequate scratch, DB/audit | PASS locally |
| RSC-12 | pipeline `RESOURCE_oom_VERIFY`, clamd OK followed by OOM signal, DB/audit | PASS locally |
| RSC-13 | pipeline `RESOURCE_instance_VERIFY`, changed identity, DB/audit | PASS locally |
| RSC-14 | pipeline `RESOURCE_unavailable_VERIFY`, clamd OK followed by unavailable probe, DB/audit | PASS locally |
| RSC-15 | pipeline `RESOURCE_before_VERIFY` leaves PENDING, then `SCAN_FINAL` proves CLEAN after recovery | PASS locally |
| RSC-16 | pipeline `RESOURCE_before_VERIFY` with fake clamd liveness healthcheck healthy and probe unavailable | PASS locally |
| RSC-17 | pipeline `SCAN_FINAL`, real clamd and safe PDF | PASS locally |
| RSC-18 | pipeline `SCAN_FINAL`, real clamd and EICAR | PASS locally |

The application checks and fake fault modes do not replace independent backend/security and DevOps reviews. Exact-HEAD GitHub CI is required before acceptance.
