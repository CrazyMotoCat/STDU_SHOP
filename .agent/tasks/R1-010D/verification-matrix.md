# R1-010D Stage B verification matrix

This records local evidence, not production readiness. `pipeline` means `apps/api/test/r1-010d.pipeline.runtime.test.ts` executed by `pnpm test:r1-010d` against disposable PostgreSQL and real or explicitly controlled scanner fixtures. `protocol` and `storage` mean the corresponding `r1-010d.*.test.ts` unit suites. Runtime files use generated fixtures.

Historical evidence below predates the current containment policy unless explicitly marked current. Draft CI run 40874413215 failed in the catalog migration harness: its two temporary databases share one PostgreSQL cluster, while the scanner migration deliberately reserves cluster-wide role names. The catalog harness now deploys only pre-scan migrations in both catalog databases; the R1-002B harness deploys the full set in its primary database and pre-scan migrations in its separate repeat fixture database. The dedicated R1-010D runtime applies the actual scanner migration and verifies role preflight and quarantine backfill. Both adjusted harnesses passed locally; the R1-002B browser loopback case was skipped because ports 3000/3001 were occupied.

## Frozen SCAN scenarios

| ID | Evidence | State |
| --- | --- | --- |
| SCAN-01 | safe PDF, real clamd and pipeline | CONTAINMENT PASS: SCAN_ERROR; expected functional CLEAN BLOCKED |
| SCAN-02 | safe CSV, real clamd and pipeline | CONTAINMENT PASS: SCAN_ERROR; expected functional CLEAN BLOCKED |
| SCAN-03 | independently validated workbook, real clamd and pipeline | CONTAINMENT PASS: SCAN_ERROR; expected functional CLEAN BLOCKED |
| SCAN-04 | pipeline `SCAN_FINAL`, EICAR, PostgreSQL and denied staff download | PASS locally |
| SCAN-05 | pipeline `SCAN_OFFLINE`, no claim while scanner unavailable | PASS locally |
| SCAN-06 | pipeline `SCAN_HARD_TIMEOUT_PREP/VERIFY`, short deadline and fake clamd | PASS locally |
| SCAN-07 | protocol unknown/invalid response fixtures | PASS locally |
| SCAN-08 | protocol truncated input/reply and integrity trailer fixtures | PASS locally |
| SCAN-09 | generated direct boundaries, nested ZIP/XZ, MaxFiles and encrypted cases; selected pipeline fixtures | PARTIAL: MaxScanTime, PCRE and full per-fixture PostgreSQL/audit/download coverage are not proven |
| SCAN-10 | pipeline `UPLOAD` runs for both 10 MiB and 50 MiB profiles | PASS locally |
| SCAN-11 | storage hash/size mismatch and pipeline `DB_SOURCE_MISMATCH_AUDIT` | PASS locally |
| SCAN-12 | pipeline `DB_PROCEDURES`, claim/finalize replay and fencing | PASS locally |
| SCAN-13 | pipeline `DB_PROCEDURES` and `DB_SAME_ROW_LOCK_AND_AUDIT`, PostgreSQL locks | PASS locally |
| SCAN-14 | pipeline `SCAN_RESTART_PREP/VERIFY`, process kill and lease recovery | PASS locally |
| SCAN-15 | pipeline `DB_SAME_ROW_LOCK_AND_AUDIT`, transactional fault injection | PASS locally |
| SCAN-16 | pipeline `DB_ROLE_BOUNDARIES`, restricted roles and procedures | PASS locally |
| SCAN-17 | `pnpm test:r1-010b`, synthetic pre-existing CLEAN download scope and permissions | PASS on disposable DB, 34 tests; current scanner does not produce CLEAN |
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
| RSC-15 | unavailable probe leaves PENDING; after recovery completeness gate still denies CLEAN | CONTAINMENT PASS; functional CLEAN BLOCKED |
| RSC-16 | pipeline `RESOURCE_before_VERIFY` with fake clamd liveness healthcheck healthy and probe unavailable | PASS locally |
| RSC-17 | pipeline `SCAN_FINAL`, real clamd and safe PDF | PASS locally |
| RSC-18 | pipeline `SCAN_FINAL`, real clamd and EICAR | PASS locally |

Historical review of the OLE2 fixture (not an assertion that overall completeness is proven): a synthetic nested Workbook/XZ fixture produced the exact XZ dictionary-limit alert, a control fixture produced the EICAR alert, and PostgreSQL runtime verified SCAN_ERROR and audit. The protocol classifies the XZ dictionary limit alert as incomplete rather than malware. Exact MaxFiles was also observed. A separate real 64 MiB + 1 expanded-entry fixture returned `stream: OK`, without the required MaxFileSize alert. The observed missing alert does not alone prove which bytes were examined; current worker and DB gates contain CLEAN promotion for new documents. The remaining version-specific bounds require real evidence or the applicable fail-closed gate. Subsequent scanner container SIGTERM showed exit 143, but individual child graceful handling and orphan/socket evidence remain open. The exact-head CI result is recorded below.

## 2026-10-30 DB containment update

- Disposable PostgreSQL `R1_010D_DB_`: 5/5 passed in `runtime-final-replay.log`; the worker principal with a real claim, matching attestation and canonical fingerprint received the completeness-policy refusal on repeated, concurrent, stale and exact-replay calls. Runtime and operator principals were denied; permitted REJECTED and its replay succeeded. DB snapshot/audit did not change on refusal.
- A synthetic legacy CLEAN download succeeded in the disposable `R1_010D_UPLOAD` phase of that run, illustrating why the pre-deployment plan blocks rollout until provenance and an owner-approved remediation are settled. No production database was inspected.
- Pinned ClamAV directly detected EICAR and valid ZIP EICAR; XZ dictionary, MaxFiles and MaxScanSize generated their respective limit alerts. The expanded MaxFileSize fixture returned OK. A valid workbook independently passed ZIP CRC/extraction and openpyxl A1 round-trip; its EICAR worksheet returned OK directly. This is not proof of a specific extraction defect or exploitability.
- Runtime with the new workbook initially failed at the unrelated test-source 429 quota. Only the disposable test Redis intent-hour counter is reset between synthetic batches; the corrected run subsequently passed; the complete boundary matrix and child-level SIGTERM evidence remain outstanding. Safe inputs intentionally do not become CLEAN; functional acceptance remains pending.


## Current evidence — 2026-10-30

- Published HEAD `a3fbac40aa6cc58a14470b35e4063259a04be1fe`: local `pnpm test:r1-010d` PASS (`runtime-final-head.log`) and [GitHub CI 41029026480](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41029026480) SUCCESS. CI includes `test:r1-010b`, `test:r1-010c:e2e` and the quality gate. These results apply to that exact HEAD, not later changes.
- Independent security review: containment PASS for new documents and normal worker/DB roles; historical CLEAN needs separate pre-deployment inventory and approved remediation. Functional acceptance remains blocked for all three formats.
- Current SCAN-01…03 are containment outcomes only: a safe source is SCAN_ERROR / ENCRYPTED_OR_UNSCANNABLE, with FAILURE audit and access denied. SCAN-04 remains confirmed EICAR REJECTED. RSC-15 and RSC-17 likewise do not demonstrate CLEAN. Earlier positive CLEAN evidence above is historical and superseded by the policy gate.
- Worker restart fixture tests active LEASED → Compose stop → RETRY_WAIT / STREAM_INTERRUPTED, QUARANTINED and audit; first lease expiry is accelerated by test SQL. Scanner container SIGTERM exited 143 after both child processes were observed, but separate signal delivery, individual graceful exit, host orphan and socket cleanup were not proven.

| Boundary | Real pinned clamd observation | Coverage and database evidence |
| --- | --- | --- |
| MaxFileSize 64 MiB | Expanded 64 MiB + 1 entry: `stream: OK` | PARTIAL: no independently verified below/equal/above matrix or full corresponding pipeline. Global worker/DB gate denies CLEAN. |
| MaxScanSize 256 MiB | 5 × 54 MiB expanded synthetic entries: `Heuristics.Limits.Exceeded.MaxScanSize FOUND` in one run and `stream: OK` in another | PARTIAL: fixture hashes/signature identity not preserved for comparison; not a reproducibility or exact boundary proof. Global gate denies CLEAN. |
| MaxFiles 10000 | 10100 nested generated entries: `Heuristics.Limits.Exceeded.MaxFiles FOUND` | PARTIAL: counting semantics and 9999/10000/10001 not proven; matching pipeline records SCAN_ERROR / SCAN_LIMIT_EXCEEDED and FAILURE audit. |
| MaxRecursion 10 | Existing nested generated archive limit fixture maps to SCAN_ERROR | PARTIAL: exact below/equal/above direct replies and semantics unverified. |
| MaxScanTime 120000 ms | No verified actual clamd time-limit reply | NOT PROVEN. A shortened worker absolute-deadline test uses a fake scanner, not a clamd MaxScanTime proof. |
| PCREMaxFileSize 64 MiB | `PCREMaxFileSize 64M` observed in loaded configuration | NOT PROVEN: no PCRE-specific signature and boundary behavior evidence. |
| Encrypted/unsupported | Protocol synthetic classification only | NOT PROVEN on real clamd and matching full pipeline. |
| XZ dictionary | `Heuristics.XZ.DicSizeLimit FOUND`; OLE/XZ EICAR control FOUND | PARTIAL: exact alert and SCAN_ERROR/audit for corresponding pipeline proven; independent structurally valid related OLE fixture and boundaries incomplete. |

All observed `stream: OK` outcomes remain unavailable under the global gate; file hash proves source identity, not scanner completeness. Do not infer DB or download outcomes from direct clamd probes. Configuration file observed in pinned clamd container (effective daemon reload state independently unproven): StreamMaxLength/MaxFileSize/PCREMaxFileSize 64M, MaxScanSize 256M, MaxFiles 10000, MaxRecursion 10, MaxScanTime 120000, AlertExceedsMax and AlertEncrypted enabled.

## Generated boundary observations (direct clamd, 2026-10-30)

Reproduction: The isolated runtime invokes `python apps/api/scripts/r1-010d-boundaries.py <owned-compose-project> <owned-clamav-container>` with its per-run ownership marker; it loads the source classifier through tsx. The script verifies the container's Compose project label, generates synthetic bytes, validates ZIP CRC and full extraction, prints exact SHA-256/replies/classifier results, and captures the local clamdscan utility version at both ends; daemon VERSION was not independently captured for that historical run. Evidence is task-owned `boundary-classified.log`; it is not a PostgreSQL/audit/download test. Scanner image ID `sha256:7b7245ba46c2b744a0727654e06d2b02aebf2ced2c96a99c49f610dcc9449b20`, clamdscan utility `1.4.6/28169/Fri Oct 30 06:26:48 2026` at both ends; that alone does not attest the running daemon. Direct clamdscan client semantics must be considered independently of proof that all bytes reached the engine.

| Generated input | Exact clamd reply | Actual classifier followed by closed completeness gate |
| --- | --- | --- |
| Direct EICAR; ZIP with EICAR | `stream: Eicar-Test-Signature FOUND` | REJECTED |
| Original 64 MiB − 1, equal, + 1; single ZIP entry with same expanded sizes | All six `stream: OK` | SCAN_ERROR / ENCRYPTED_OR_UNSCANNABLE |
| ZIP with five entries totalling 256 MiB − 1, equal, + 1 extracted bytes | All `stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND` | SCAN_ERROR / SCAN_LIMIT_EXCEEDED |
| Identical 256 MiB + 1 ZIP, repeated with the same SHA and scanner VERSION | Same MaxScanSize alert on both attempts | SCAN_ERROR / SCAN_LIMIT_EXCEEDED |
| ZIP 9999 entries | `stream: OK` | SCAN_ERROR / ENCRYPTED_OR_UNSCANNABLE |
| ZIP 10000 / 10001 entries | `stream: Heuristics.Limits.Exceeded.MaxFiles FOUND` | SCAN_ERROR / SCAN_LIMIT_EXCEEDED |
| Nested ZIP depth 7, 8, 9, 10, 11 | All `stream: OK` for these generated structures | SCAN_ERROR / ENCRYPTED_OR_UNSCANNABLE |

Expanded totals exclude container overhead and therefore are not the engine's internal budget; a limit alert even below 256 MiB does not identify its accounting threshold. Other generated nested archives have produced MaxRecursion alerts, but without an identical hash/format comparison they do not establish a contradiction. The above direct cases are not individually proven through API → worker → PostgreSQL → audit → denied download. MaxScanTime, PCRE boundary behavior and real encrypted/unsupported content remain NOT PROVEN; do not call this a complete boundary matrix.

- AES-encrypted synthetic ZIP: pyzipper 0.4.0 verified encrypted flag and decrypted-byte round-trip; real clamd returned `stream: Heuristics.Encrypted.Zip FOUND` (`boundary-encrypted.log`). Corresponding exact encrypted fixture has not been checked end-to-end through DB/audit/download.

- A separate exact synthetic AES ZIP (SHA-256 `870c4fc68181c645769a4fcaf5022340cc679f72b65b3770931679c194fa617d`) decrypts and round-trips independently and returned `stream: Heuristics.Encrypted.Zip FOUND` when scanned directly. The pipeline wraps it as an unlinked ZIP part in an XLSX; SCAN_ERROR, failure audit and denial were observed, but the precise nested clamd reply and OOXML linked-object handling are not established. The large-entry pipeline input is ZIP/XLSX-like without a full workbook graph.

## Additional current evidence — 2026-10-31

- A subsequent isolated runtime (`runtime-final-optimized.log`) observed running daemon VERSION before and after the boundary tests and tracked five scanner-container PIDs with process start times via a non-root, network-disabled observer. All five identities disappeared after SIGTERM; container exit was 143 and scanner/probe readiness recovered on restart. This does not prove individual graceful handling or socket inode release.
- Real pipeline fixtures for an encrypted ZIP part and a large expanded entry reached SCAN_ERROR / ENCRYPTED_OR_UNSCANNABLE, STOPPED, FAILURE audit / INTERNAL_ERROR and denied download. These are not end-to-end results for every direct boundary input. No actual MaxScanTime or PCRE-specific boundary fixture has been established, so complete boundary coverage remains NOT PROVEN.
- Local `pnpm test:r1-010b` passed 34 tests; `pnpm test:r1-010c:e2e` passed 13 checks; lint, format, typecheck, test (149 Vitest passed, 125 skipped; 15 pytest passed) and build passed on the then-current task worktree. Subsequent harness-only changes require their own final checks and exact-head CI.
- The previous table's encrypted-content NOT PROVEN entry is historical: direct AES detection and the distinct nested pipeline fixture are now evidenced as described above, without claiming that the nested scanner reply was observed.
- At 06:56 UTC official `current.cvd.clamav.net` advertised daily 28169. A separate pinned container fetched it through FreshClam with verification; sigtool showed 2026-10-30 06:26 UTC, version 28169 and Verification OK, and the daemon started with that file returned `ClamAV 1.4.6/28169/Fri Oct 30 06:26:48 2026`. The file owner was clamav:clamav. The loaded database was older than 24 hours, so this is EXTERNAL_SIGNATURE_FRESHNESS_BLOCKER at the observed time, not a scanner acceptance PASS. The failed `runtime-final-last.log` ended in SCAN_FINAL with nonterminal jobs; its disposable project was cleaned up. No security gate was relaxed.

## GitHub runtime with refreshed official signatures — 2026-10-31

- [CI 41179250505](https://github.com/CrazyMotoCat/STDU_SHOP/actions/runs/41179250505) SUCCESS on `9a3465dd0141621113ce8b056656f9b4fc5662e8`: full R1-010D, R1-010B, R1-010C E2E and quality checks passed. The worker preflight reported ClamAV 1.4.6, database 28170 dated 2026-10-31 06:24:42 UTC, age 3072 seconds and resource probe ready. Daemon VERSION was 28170 both before and after boundary observations. This supersedes the external blocker on that runner, not the historical evidence for database 28169.
- SCAN_FINAL passed fail-closed assertions, EICAR rejection and denied downloads. Direct EICAR and encrypted AES ZIP produced expected FOUND replies. CI did not run optional AES decryption validation; independent local round-trip evidence is recorded above.
- SIGTERM: both scanner/probe ports connected before and timed out after; all five recorded PID/start-time identities disappeared, container exited 143 and readiness recovered after restart. TIMEOUT demonstrates lack of successful connection, not socket inode release; individual signal handling and later descendants remain unproven.
- MaxScanTime, PCRE-specific behavior and full per-boundary DB/audit/download coverage remain NOT PROVEN. A green suite does not change completeness policy or authorize legacy CLEAN download or production use.
