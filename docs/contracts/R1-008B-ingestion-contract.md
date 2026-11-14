# R1-008B Supplier Ingestion Backend

Status DRAFT, implementation contract 1.0.0. Owner task authorizes additive implementation and isolated tests in one Draft PR. SRC-01…08 and R1-007 individual review/identity rules apply.

Nest owns staff commands and background execution. PostgreSQL stores sources, immutable source revisions, runs, raw snapshots, rows, decisions, command receipts and outbox. Redis carries UUID wake-ups. Python normalizes only fixed TEST fixtures through an authenticated internal endpoint. Manual ACCEPT/REJECT records a staging verdict. Applying a verdict belongs to R1-009.

## Staff API

All routes live under /v1/staff/ingestion and use current staff sessions. Mutations require Origin, staff-bound CSRF and an 8–128 character Idempotency-Key. New permissions are default-deny and excluded from FULL_ADMIN_PERMISSIONS.

| Operation                | Permission              | Input                                                                                                                                 |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET sources, sources/:id | ingestion.read          | limit 1–100, cursor UUID                                                                                                              |
| POST sources             | ingestion.sources.write | supplierId UUID, adapterVersion fixture-json/1, fixtureKey offers-v1 or mixed-v1, maxRows 1–100, maxAttempts 1–5, timeoutMs 100–10000 |
| PATCH sources/:id        | ingestion.sources.write | expectedVersion, state ENABLED/DISABLED, optional limits                                                                              |
| POST runs                | ingestion.run           | sourceId, expectedSourceVersion                                                                                                       |
| GET runs, runs/:id       | ingestion.read          | limit 1–100, cursor UUID                                                                                                              |
| GET runs/:id/rows        | ingestion.read          | limit 1–100, afterRow 0–100                                                                                                           |
| POST rows/:id/decision   | ingestion.review        | expectedVersion, decision ACCEPT/REJECT, reason 1–500 characters                                                                      |
| GET rows/:id/decisions   | ingestion.read          | immutable terminal decision history                                                                                                   |

Source adapter/supplier/fixture identity is immutable. PATCH creates a new source revision and invalidates queued work captured at the old version. Supplier must be ACTIVE on source creation, run creation and worker execution. Request identity includes operation, resource, actor, canonical validated DTO and versions. Durable command receipts are actor-scoped across these commands. Same key and body returns the saved response after current authorization checks. Different body conflicts. Terminal 409 receipts require a new key to correct versions. Staff requestId and actor are server-derived.

## Delivery and recovery

A manual run and its outbox are committed together. Run states are QUEUED, RUNNING, RETRY_WAIT, COMPLETE, PARTIAL, FAILED. The dispatcher republishes pending/expired work from PostgreSQL even if Redis loses messages. Each claim locks the run, increments attempts and issues a new random lease token with a database-clock expiry. Heartbeats and writes are fenced by token and live lease. Source version/state is rechecked before committing results.

The worker captures the original bytes/hash durably before committing extraction rows. Retries send those bytes back to Python. Deterministic per-run row IDs and unique run/coordinate constraints make delivery idempotent. Candidate/error rows and counts/final state/audit commit atomically. A lost COMMIT response is resolved by reading durable state, and a redelivered terminal run is a no-op. Expired workers cannot overwrite a newer lease. Attempts are bounded by source policy, retries use capped exponential backoff. PostgreSQL failure leaves outbox/run state recoverable. Redis AOF is operational support for delivery, while PostgreSQL remains authoritative.

Background worker is opt-in via SUPPLIER_INGESTION_WORKER_ENABLED=true and uses SUPPLIER_INGESTION_URL and a shared SUPPLIER_INGESTION_TOKEN of at least 32 characters. The URL is operator configuration, never staff input. Internal HTTP has timeout, redirect denial and response/body/row bounds. The worker code exposes a one-cycle tick for deterministic integration testing.

## Python protocol

POST /internal/v1/supplier-ingestion/extract requires Bearer SUPPLIER_INGESTION_TOKEN.
Request is {protocol: r1-008b.mock.v1, run_id: UUIDv4, adapter_version: fixture-json/1, fixture_key: offers-v1|mixed-v1, raw_snapshot: base64|null}.
Response is {protocol, run_id, adapter_version, source_hash: SHA-256 hex, raw_snapshot: base64, results: array of R1-008A Candidate or RowError}. Snake-case R1-008A field shapes are retained. Raw data is bounded to 1 MiB and 100 rows. Normalized values preserve missing facts, exact decimal strings and unverified identity.

## Data and audit boundaries

Source history, command receipts, raw provenance, extraction rows and decisions are append-only except for the explicit row review state/version and run processing fields. One terminal verdict per candidate. Error rows cannot be accepted. No SupplierOffer/catalog/match/price write occurs.

Audit uses additive ingestion.* actions. Staff source/run/review commands, denials and worker starts/snapshot/completion/retry/failure are recorded. Payloads contain IDs, versions and counts only. Secrets, raw bytes, normalized values and decision reason text stay out of audit/logs. Reads expose paged staff DTOs and never raw snapshot bytes or lease tokens. Operational failures use existing safe error codes and bounded diagnostic codes.

## Retention and release gate

Source snapshots, revisions, staging, decisions, command receipts and delivery history are retained without an automated purge in this R1 slice. Production retention, backup/RPO/RTO and deletion/legal-hold procedures require owner acceptance before deployment. No live adapters or production migration/deployment are authorized by this Draft PR.

## Verification

`pnpm ingestion:contract:check` reproduces and validates the [Staff OpenAPI](R1-008B-ingestion.openapi.json). The existing Staff permission enum receives the four additive values from [the R1-008B registry](R1-008B-rbac.json).

`pnpm test:r1-008b` starts a unique loopback Compose project and an owned Python process. The PostgreSQL volume belongs to that project and is cleaned up after the run. The suite covers guarded HTTP, concurrent requests and leases, decision replay, partial extraction, source invalidation, worker death, Redis message loss, PostgreSQL restart, lost completion acknowledgement and provenance constraints. The COMMIT test injects a lost acknowledgement immediately after a real database transaction commits. It does not interrupt the PostgreSQL wire protocol.

| Scope             | Evidence                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| SRC-01, SRC-02    | ING-01…04 verify approved fixtures, manual request, permissions, CSRF, versions and disabled sources              |
| SRC-03, SRC-05…07 | ING-01, ING-05 and ING-12 verify staged provenance, immutable facts, partial results and business table isolation |
| SRC-04            | ING-05 verifies individual decisions, OCC and replay. Applying a verdict and the staff UI are R1-009              |
| SRC-08            | ING-06…11 verify leases, worker termination, dependency restart, ambiguous completion and bounded attempts        |

The independent reviewer ran all 12 isolated integration tests successfully after fixes for the API schemas, null patch fields and PostgreSQL integrity checks. Local Python suite: 167 passed and six platform-specific skips on Windows.
