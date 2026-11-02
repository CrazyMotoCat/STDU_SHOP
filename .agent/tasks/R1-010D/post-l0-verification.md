# R1-010D Stage B — post-L0 compatibility gate

Date: 2026-11-03 (Asia/Vladivostok). Delivery: REVIEW_REQUIRED / Draft PR #28 / NO MERGE / NO PRODUCTION.

## Git reconciliation

- Stage B source HEAD: `270131d36f5d54fc5035785e269f5eefcce729ff`.
- Fresh main baseline: `74dd704963f6e0f1fb1fe4afa95cce2a8bbce79d`; includes L0 merge `e9af3a7dbe0eee29bb3cacceb3d608662502b0b3`.
- Local backup: `codex/r1-010d-post-l0-backup-20261103` points to the source HEAD.
- History-preserving integration: `a1a70c731448fbb5c3caaba8e250c674d7dcdbe1`, parents source HEAD and main baseline.
- Only textual conflict: `.agent/tasks/R1-010D/state.md`. Current L0 record retained; previous Stage B checkpoint appended as historical evidence. No runtime/security/FROZEN conflict was resolved manually.
- Pre-existing untracked logs/experiments retained and excluded from staging.

## Change and invariants

The pre-L0 pipeline fixture expected historical CLEAN to download with HTTP 200. The initial disposable run reproduced `expected 404 to be 200`; this was a test expectation incompatible with approved L0. The fixture now requires 404 JSON / FILE_NOT_ACCESSIBLE and unchanged complete document and ordered audit snapshots. No runtime or contract edit beyond integration is required.

The combined staff download path revalidates current session, download/read permissions, inquiry read permission and scope, and document membership. It then unconditionally refuses before opening storage or writing successful download audit. CLEAN, whether historical or synthetic, is not eligibility. Missing credentials/permissions and infrastructure failure keep existing 401/403 and safe error handling. Public submission/upload/cancel routes add no original-download operation.

Internal scan-stream remains a distinct private POST boundary: job/version/token plus DB live lease/source authorization precede original read. Worker cannot use staff download or directly mount original files. Worker and DB finalizer independently prohibit positive CLEAN. Original descriptors and historical audit remain preserved.

Runtime service/controller, frozen manifests, OpenAPI and generated Inquiry TypeScript are identical to the main baseline. Contract versions remain R1-010 FROZEN 1.0.3 and R1-010D FROZEN 1.0.1.

## Fresh verification

| Check | Result | Evidence |
| --- | --- | --- |
| R1-010 / R1-010D frozen checksums | PASS | Both checkers; no diff from main contract artifacts |
| Frozen checker regression tests | PASS | 40/40, post-l0-contracts.log |
| Inquiry OpenAPI export/validation/parity | PASS | post-l0-openapi.log; initial attempt required local env:init, then passed |
| Generated Inquiry TypeScript reproduction | PASS | openapi-typescript --check |
| R1-010B PostgreSQL/Redis/HTTP | PASS | 34/34, post-l0-010b.log; owned project cleaned |
| R1-010C real browser E2E | PASS | 13 checks, post-l0-010c.log; owned project cleaned |
| Lint / format / typecheck / build | PASS | post-l0-*.log |
| Unit tests | PASS | 150 Vitest passed / 132 optional runtime skips; 15 pytest passed |
| Initial Stage B runtime | FAIL (explained) | post-l0-010d.log: old positive historical CLEAN assertion; task-owned cleanup completed |
| Corrected Stage B runtime / real ClamAV | PASS | Exit 0, post-l0-010d-corrected.log; all staged phases and cleanup completed |
| Exact final HEAD hosted CI | Publication gate | Final pushed SHA and hosted completion are recorded in PR #28 description and owner report; source HEAD CI is historical only |

Local shell Node 24.22.1 differs from repository pin 24.19.0; child tools and disposable runtime use their configured runtime. No gate was weakened for this warning.

## Independent read-only reviews

- Backend + PostgreSQL/security (`post_l0_backend`): PASS after correction of obsolete legacy CLEAN test. Verified transactional finalizer, role privileges, lease/version/token fencing, no positive staff storage path. No unresolved HIGH/BLOCKER.
- Application Security (`post_l0_security`): PASS including re-review of corrected test; routes/permissions/source membership and internal streaming separation inspected. No new security finding.
- DevOps/infrastructure + contract compatibility (`post_l0_devops`): PASS for static review; both frozen checkers executed. Task-owned disposable projects, image pin, private networks, scanner limits and fail-closed readiness preserved.
- Reviews cover merge a1a70c7 and the targeted 26-line test change, not unexecuted runtime/production claims.

## Remaining limits and decisions

NOT_PROVEN: full format completeness, actual MaxScanTime trigger, complete official-signature PCRE boundaries, actual FreshClam stale-to-fresh upgrade, individual child graceful shutdown/socket inode release, endpoint authenticity and immutable sealed storage against privileged writers, expiry immediately before COMMIT, production resource peaks and capacity. Controlled recovery is not a real signature upgrade.

BLOCKED: production inventory/migration/deployment, external gate opening, direct production network/storage paths, old or mixed binary rollout/rollback, positive eligibility and CLEAN enablement. SEC-API-ROUTE-001 remains a separate registered error-mapping issue. Functional Stage B acceptance is not inferred from green CI.

PR #29 remains untouched at its pre-L0 policy-proposal baseline. Before future integration, reconcile its R1-010 1.0.2 / R1-010D 1.0.0 proposal text against 1.0.3 / 1.0.1, retain L0, and obtain separate owner approval. It must not be merged into #28 as part of this gate.

Owner decision required after fresh evidence: separate technical/functional acceptance and any permission to integrate PR #28. No positive CLEAN profile, production operation or R1-011 is requested or authorized by this report.
## Corrected runtime observations

Disposable project: stdu-r1-010d-test-56468-42a16165. Real pinned ClamAV 1.4.6 preflight: daily 28172, 2026-11-02T06:24:10Z, age 27936s, ready=true; resource probe ready. Both upload profiles, legacy CLEAN denial, DB boundaries/fencing/completeness rejection, offline, timeout/restart, resource failure modes, controlled signature C1-C3 and SCAN_FINAL passed. Direct synthetic XLSX_EICAR returned OK; global worker/DB CLEAN prohibition remains mandatory. No MaxScanTime experiment was added or repeated. Scanner shutdown observed five PID identities missing, both ports timing out, exit143 and readiness after restart; individual graceful handling/socket inode release remain NOT_PROVEN.

Sampled peaks (not production sizing): ClamAV 1790 MiB /100.4% CPU; API220 MiB; worker117 MiB; PostgreSQL122 MiB; test runner695 MiB. Container memory limits remained enforced. All owned runtime containers were cleaned on exit; no foreign resources were changed.
