# R1-008A — local mock extraction protocol

Status: **DRAFT / OWNER REVIEW**, version `r1-008a.mock.v1`.
This is an executable local TEST-profile interface, not an approved NestJS API, business IngestionRun schema or amendment to FROZEN R1-007/R1-006. No production or live-source authorization.

## Job and source registry

The authoritative executable schemas are `Job`, `OfferInput`, `Candidate`, `Manifest` and `Run` in `services/ingestion/src/ingestion/supplier_models.py`. Extra fields are rejected. Job input contains only:

```json
{
  "contract_version": "r1-008a.mock.v1",
  "profile": "mock-only",
  "job_id": "b230fb20-3df9-480f-8c09-fd2fe2413285",
  "source_id": "TEST-synthetic-offers"
}
```

The fixed registry in `supplier_ingestion.py` allows only the bundled synthetic JSON source with version `1`, adapter `fixture-json/1` and a TEST supplier reference. That reference is **not** a Supplier FK or a verified supplier identity. Disabled/unknown sources and unsupported adapters fail closed, even on replay. Requests cannot supply paths, URLs, adapter code, actor IDs, permissions or publication commands. Registry dependency injection is an in-process test facility, never request data. No host allowlist/DNS/redirect implementation is claimed: there is no network fetch at all. `mock.invalid` URLs are source metadata only.

## Source rows and normalization

Raw input is a JSON array, at most 1 MiB and 100 rows. Duplicate JSON fields, non-finite constants and malformed envelopes are rejected. Each row must contain at least an offer name, supplier part number or original part number. Wrong types, unknown fields, controls, invalid Unicode, overlong strings and invalid facts produce a row error while preserving the raw snapshot.

Names and identifiers use NFC and trim only outer U+0020; preserve case, leading identifier zeroes, punctuation and internal spaces. Supplier part number and manufacturer part number remain different fields. Brand text does not become a brand ID. All identities remain `UNVERIFIED`; modification is `SPECIFIED` only when explicitly present, otherwise `UNKNOWN`, never `CONFIRMED_NONE`. No catalog IDs or match proposals are created.

Purchase cost is a positive decimal string, no float/exponent/rounding, canonicalized by removing fractional trailing zeroes. An explicit currency is required with cost. This mock profile deliberately supports only RUB/USD/EUR; this is not a new global currency policy. Missing cost, VAT, availability, lead time and source timestamp remain null. Source timestamps require an explicit timezone and are separate from extraction timestamps. Only synthetic `https://mock.invalid` source references are accepted; no URLs are fetched.

## Private artifacts and extraction states

The caller chooses a **trusted private local TEST workspace**, not a shared/public directory or a production storage volume. Python has no DB/Redis/business credentials. Per job UUID:

- `manifest.json`: immutable request fingerprint and raw SHA-256, bound before snapshot/checkpoint creation.
- `source.json`: original fixture bytes, preserved exactly; private to the local operator.
- `run.json`: source/supplier reference/version, adapter version, job identity, digest/blob reference, start/finish/duration, processed count, candidates, row errors and bounded diagnostic events. Candidate IDs bind job, raw digest, adapter and one-based row coordinate. Each candidate refers to the shared raw provenance through its run and row coordinate.

`RUNNING → COMPLETE | PARTIAL | FAILED` are extraction-only states. COMPLETE means extraction completed, **not business approval**. Invalid rows produce PARTIAL with explicit errors; an invalid envelope produces FAILED. No SupplierOffer, match, product, public price, business AuditEvent or accepted decision is written. CLI diagnostics contain only job ID/status/counts or a safe error code, never raw rows, source values, storage paths or tracebacks.

## Idempotency, interruption and limits

- One OS-backed nonblocking lock per job; concurrent invocation returns `JOB_BUSY`. Process death releases the lock, without stale-lock deletion or killing any other process.
- Writes use temporary files, file fsync and atomic replace. Manifest precedes raw snapshot and checkpoint. Interrupted bootstrap refuses a changed request/source and never overwrites surviving input with different bytes.
- Replay and resume first verify the request fingerprint and the retained snapshot against the manifest. The same adapter recomputes the processed prefix from those bytes and compares candidate IDs, coordinates, normalized fields, warnings, modification evidence and row errors. Status and cursor must agree with the source envelope and processed rows. A mismatch yields `CHECKPOINT_INVALID` before any checkpoint write. A changed source/version/supplier reference with the same job ID conflicts. Fixture changes after capture do not replace the captured snapshot.
- Staging supports Windows and Linux with a private local directory tree controlled by the operator, including its ancestors. The runner checks each component before use, rejects symlinks and Windows reparse attributes, opens the final file without following links, and checks descriptor identity, regular-file type and single-link count. The lock file needs no byte writes. Temporary checkpoints are validated before writing and replacing the destination. Unverifiable paths fail closed.
- The operator must exclude concurrent namespace replacement by untrusted processes. Component checks and file-handle validation do not bind all directory operations to parent handles. The runner does not provide a sandbox against an actor who can replace parent directories during operations or coherently replace the manifest and snapshot. The recomputation specifically detects inconsistent checkpoint data against the retained snapshot.
- Resume is **manual**, from the last committed row. Candidate/error and cursor are committed together; an uncommitted row can be recomputed. No automatic retry, scheduler, background worker or Redis queue.
- At most five persisted processing attempts, ten seconds cooperative processing budget per invocation, 100 rows, 1 MiB input, 2 MiB checkpoint read and bounded events. A budget expiry records a resumable TIME_LIMIT event. Preflight/source/storage failures use safe diagnostics; a storage failure cannot promise its own durable diagnostic write.
- Scope of recovery proof: abrupt process exit and local storage exceptions. File replacement does not claim cross-file ACID, authenticated/tamper-proof artifacts, Windows ACL provisioning, disk-loss recovery or host-power-loss durability. The workspace is trusted local test storage. Original artifacts must be retained manually; there is no purge command.

Manual invocation, exit 0 COMPLETE / 2 PARTIAL or FAILED / 3 rejected or infrastructure error:

```sh
uv run --project services/ingestion --locked python -m ingestion.supplier_ingestion --mock-only --job services/ingestion/tests/fixtures/supplier-job.json --workspace .local/r1-008a-proof
```

APP_ENV must be absent or `test`, `local`, `development`; production-like values reject execution. The module is not imported by the FastAPI application and is not exposed as a remote command. This developer CLI is not an implementation of staff admin authorization.
