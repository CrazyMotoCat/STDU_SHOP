# R1-008A — Supplier Ingestion Foundation

Delivery: REVIEW_REQUIRED, mock-only; no merge, live supplier requests or deployment.
Base: `47e04ee3d808d20c2e2dc341e5c9e1b6e6ed71a0`.

## Existing implementation and reuse boundary

- R1-007 owns Supplier/SupplierOffer immutable revisions, strict identity proposals, current permissions, durable command idempotency and transactional audit. Existing supplier migration and service remain unchanged.
- R1-006 already provides bounded CSV/XLSX parsing, catalog import staging, per-row decisions and catalog RBAC. Its staging is catalog-specific and explicitly excludes SupplierOffer; it is not reused as an unauthorized supplier-write channel.
- Python FastAPI currently provides health/readiness and the internal catalog-import parser. No supplier job registry, supplier staging or run command exists. The mock module shares this service/package/toolchain, with no new dependency, daemon, container, route or database.
- Current main Compose already uses Redis AOF with `appendfsync always` for existing workloads. That is not a job delivery/recovery contract. No Redis configuration changes are needed or made here. Existing Docker resource limits remain intact; local tests start no containers and do not touch OPS-TEST-02.

## Implemented vertical slice

Manual CLI → strict versioned job → enabled fixed TEST source → bounded immutable raw snapshot → deterministic normalized extraction candidates → private checkpoint/journal → terminal replay or explicit manual resume.

See [executable protocol and operational limits](../contracts/R1-008A-mock-extraction.md). This is a local foundation proof, not a production supplier ingestion service. Nest remains the only business-state authority because this slice does not issue any business command. Existing staff sessions, RBAC, CSRF, audit and supplier idempotency paths are unchanged; no new privilege is invented or granted.

## Recovery policy before introducing queues

**Implemented mock profile:** private artifacts are extraction progress only. Source bytes and request identity are bound before row processing; checkpoint replacement gives process-restart recovery. Uncommitted row progress may be lost and recomputed; a committed cursor and its candidates/errors replay together. There is no automatic retry or Redis persistence dependency. Disk loss requires restoring retained fixture/artifacts or starting an explicitly new TEST job; no production RPO/RTO is asserted.

**Recommended next-stage design, not implemented/approved:** Nest-owned PostgreSQL run/staging ledger and transactional outbox are the source of truth. Redis is an at-least-once wake-up/delivery transport, not authoritative state. A reconciliation worker redelivers unfinished/outbox jobs after Redis loss; leases/attempts/backoff and per-job/per-row uniqueness prevent duplicated staging. Nest validates source/actor/snapshot and atomically stores candidate receipts; no job completion or Redis ACK implies approval. Losing committed business/staging records is not acceptable; unacknowledged extraction work may be repeated. PostgreSQL/private-source backups and restore rehearsal must be defined before production; no exact production RPO is promised here.

An in-memory/Redis-only queue is rejected as the foundation: AOF alone cannot atomically bind Nest business state, original provenance, delivery and audit. No queue is implemented until the following contract decision is accepted.

## Concrete owner decision needed for the next stage

1. **Recommended:** approve an additive R1-008B contract package for Nest IngestionSource/IngestionRun/candidate storage, new manual-request/read/review permissions, append-only audit actions and transactional receipts/outbox. Freeze schemas/DTO/OCC/idempotency before migration or endpoint implementation. Preserve one-at-a-time review and existing R1-007 commands; no mass apply. Define whether raw source capture alone needs a business AuditEvent and where individual field decisions are persisted.
2. **Alternative:** retain an offline export workflow only, with a permitted employee manually recording reviewed offers through existing R1-007 APIs. This avoids new tables/endpoints but does not deliver integrated source management or run/review history.

No silent choice is made for business permissions, source approval/legal review, review retention, source freshness or the unit of per-field acceptance. Future HTTP adapters additionally require source-specific legal approval, SSRF/DNS/IP/redirect containment, limits and credential policy. No current mock code is represented as live-network security acceptance.

## Requirement and test matrix

| Requirement                             | Implementation / verification                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRC-01: allowed source identity         | Fixed TEST registry; disabled, unknown, URL/path/adapter injection rejected                                                                           |
| SRC-02: explicit manual run and journal | CLI opt-in; job/source versions, safe events, timestamps/duration/counts; no schedule or HTTP run endpoint                                            |
| SRC-03: staging/provenance only         | Byte-exact raw snapshot and digest, immutable bootstrap manifest, deterministic candidate IDs/coordinates; no business credentials or publishing code |
| SRC-04: human approval                  | No acceptance/apply/publish operation exists; COMPLETE is extraction only; business review integration pending its own contract                       |
| SRC-05: no inferred identity            | Exact text normalization; supplier code separate; brand text unverified; unknown modification stays UNKNOWN                                           |
| SRC-06: source facts                    | Decimal strings; explicit currency; missing facts stay null; timestamp timezone validation; no fabricated VAT/stock/lead time                         |
| SRC-08: failures isolated               | Invalid rows yield PARTIAL, invalid envelope FAILED; safe CLI diagnostics; previous results retained                                                  |
| Repeated job                            | Identical terminal replay byte-stable; changed source version/reference conflicts; no duplicate candidates                                            |
| Interruption                            | Actual subprocess `os._exit` after one row; OS lock releases, manual resume completes without duplicates                                              |
| Partial storage failure                 | Injected checkpoint failure preserves prior committed row; safe error and manual recovery                                                             |
| Bootstrap/corruption                    | Interrupted manifest/snapshot/state ordering; source digest and checkpoint metadata/coordinate/count validation                                       |
| Resource/retry limits                   | Bytes/rows/strings, cooperative deadline, persisted attempt cap, bounded checkpoint/events                                                            |
| RBAC/audit/SupplierOffer boundaries     | No endpoint/DB client added; network/client traps and invalid DB/Redis env still complete; existing contract/runtime CI remains required              |

Tests: `services/ingestion/tests/test_supplier_ingestion.py`; existing health and catalog parser tests remain applicable. Independent Quality findings and exact-head FAST/FULL results are recorded in the Draft PR. No existing FROZEN artifact, migration, API contract, audit registry or permission is edited.

## Local verification

- Targeted supplier tests: 45 passed; complete Python suite: 111 passed. Existing Starlette/httpx deprecation warning remains nonblocking.
- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`: passed (Ruff, strict mypy and TypeScript included).
- `node docs/contracts/check-R1-007.mjs`, `node --test docs/contracts/check-R1-006-contract.test.mjs` (7 tests), `node docs/contracts/check-R1-010.mjs`: passed.
- Manual fixture CLI invoked twice: COMPLETE, two candidates, zero errors, stable replay. Python wheel includes the bundled source fixture.
- Independent read-only Quality: PASS; reviewer independently ran all 45 targeted tests. Review found one NFC-expansion/length/replay defect; fixed with a dedicated regression before publication. No remaining P0/P1/P2.
- Hosted FAST/FULL is required on the final PR revision; local results do not substitute for it. No deployment or business/database initialization performed.
