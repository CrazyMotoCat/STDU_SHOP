# R1-010 — Public Inquiry Domain Contract

**Status:** PROPOSED; owner approval required before implementation.
**Version:** 0.1.0-proposed.
**Task:** R1-010B-01.
**Baseline:** origin/main `6b9f03e67f51f8e201a04047afd282c71b1d335e`.
**Delivery:** REVIEW_REQUIRED; this package contains no application API or migration.

## Source and compatibility

This contract covers REQ-01…04, CAT-01, CAT-03, CAT-07, R1-010 in the backlog, and REQB-01…35. It extends but does not amend FROZEN R1-002, R1-004, R1-006A or R1-007A, nor decisions 1–108. It uses the R1-010A proposal in PR #18 as read-only input. The front-end proposal remains owned by its author and is not edited here.

The application remains the existing modular monolith: Next.js calls NestJS; NestJS owns Inquiry authorization, validation, transactions and audit; PostgreSQL is the business source of truth; Redis backs bounded anti-abuse counters; the configured private StoragePort stores original bytes. R1-010 does not call FastAPI. Customer document parsing is R1-011.

## Scope

One Inquiry aggregate supports EQUIPMENT, PANELS and ENGINEERING requests. It preserves submitted wording and equipment lines, records a contact snapshot, accepts privately quarantined originals, and exposes a permission-scoped staff queue, assignments, transitions, history, internal comments and protected document access. Staff actions are individually authorized, audited, idempotent and use OCC where they mutate aggregate state.

The proposed model adds six tables: Inquiry, InquiryLine, InquiryComment, InquirySourceDocument, InquiryUploadIntent and InquiryCommandIdempotency. AuditEvent and StaffUser are reused; a product slug is stored only as untrusted text and no catalog entity/table is reused or mutated. There are 15 OpenAPI operations (4 public and 11 staff) and 9 additive permissions. The staff API exposes an optional human-managed due date for the current workflow stage, distinct from the customer's desired deadline; there is no automatic SLA calculation or notification. See the data model, OpenAPI, RBAC matrix, audit registry and acceptance matrix for normative details.

## Non-goals

No customer account, public inquiry lookup/status API, order, BOM, cost calculation, quote generation, automatic SKU match, substitute selection, bulk approval, PDF/XLSX/CSV extraction, OCR, supplier import, automatic permission grant, notification provider, production migration or deployment. QUOTE_SENT is set only by a later quote-delivery command; it cannot be forged through a generic staff transition.

## Request shapes

- EQUIPMENT requires one to 50 separate InquiryLine entries. Each line retains raw title, original SKU, manufacturer, modification, quantity string, unit and comment. Optional product slug is untrusted context only; it is never matched or linked automatically.
- PANELS requires PROJECT_READY, MODIFY_TYPICAL or DEVELOP_FROM_BRIEF, cabinet purpose and positive quantity; requirements, work list and description are retained as submitted. These identifiers align with the read-only R1-010A proposal.
- ENGINEERING requires direction, system type, technical task and expected deliverables; deadline is optional.
- Contact name is required; at least email or phone is required in the recommended model. Organization, tax identifier, preferred channel, region and deadline are optional. Exact legal notice/consent is unresolved in OD-010-02.

All user text is inert, bounded and escaped on display. Unknown fields are rejected. The initial customer submission, equipment lines, kind and public receipt are immutable snapshots. Staff cannot rewrite what the customer submitted; corrections are added as internal comments or future explicitly versioned records.

## HTTP semantics

POST /v1/public/inquiries creates synchronously. It returns 201 only after the Inquiry, lines, durable idempotency result and inquiry.created audit commit in one PostgreSQL transaction. The receipt contains a random opaque publicReference, timestamp and a neutral acknowledgement with no response-time promise. The reference provides no query or file access. The alternative 202 is reserved for a later genuinely asynchronous acceptance flow; the R1-010A proposal's suggestion remains a choice for OD-010-05.

Every mutating command requires Idempotency-Key. The key is hashed, request hashes use RFC 8785 canonical JSON of validated normalized input, and the response receipt is persisted in the same transaction. Create-request canonicalization includes SHA-256(uploadCapability), never the raw capability. Upload-content canonicalization includes the actual byte digest, detected MIME, byte count and bound intent ID. Same key and same hash replays exactly; same key with another hash returns 409 IDEMPOTENCY_KEY_REUSED. PostgreSQL unique indexes serialize concurrent requests. Before a staff receipt is looked up or replayed, the API revalidates the live session, CSRF/Origin, action permission and read scope for the Inquiry; before upload receipt replay, it revalidates the current unexpired capability and bound intent. Authorization failure returns no stored receipt. Public create replay returns only the non-authorizing original receipt. The proposed retention is 30 days; clients must generate a fresh unpredictable key for every new action and never reuse an expired key. Request bodies and capability values are never stored in idempotency records.

Staff aggregate changes require If-Match with the Inquiry version. The version predicate, row update, transition/assignment/stage-deadline audit and idempotency receipt commit atomically. A stale request returns and durably replays 409 VERSION_CONFLICT without partial mutation or success audit. Assignment commands assign or replace an ACTIVE staff member; clearing is not supported. Generic staff transitions cannot set QUOTE_SENT or CLOSED; only a later quote-lifecycle integration may close a QUOTE_SENT Inquiry. A successful status transition clears the optional staff-managed `stageDueAt`; it can then be set or cleared explicitly with If-Match, audit and idempotency. Comments are append-only and independently idempotent; concurrent comments cannot overwrite each other.

## File boundary

The public client generates a 256-bit CSPRNG upload capability when an attachment is selected. The initial create request carries it only in the JSON `uploadCapability` field; later intent, upload and cancel requests carry it only in `X-Inquiry-Upload-Capability`. Inquiry creation stores only SHA-256(capability), with a recommended 24-hour expiry; no response contains the secret. That capability is accepted only for creating/uploading/cancelling intents bound to the same Inquiry. It never authorizes reading Inquiry data, status, attachment metadata or bytes. Each intent binds one file, declared name/type/size and start expiry; it may be consumed once. It can start only before expiry; an active stream receives a separate 15-minute deadline and remains quota-reserved until it completes, fails or expires. Knowing an Inquiry or intent UUID is insufficient.

The file is streamed through NestJS into an opaque private quarantine key, bounded while reading, sniffed against the approved allowlist and hashed. A completed attachment is a separate immutable InquirySourceDocument. It is never stored as a staff-owned R1-002 FileObject or linked through generic FileLink: those frozen tables require staff ownership. Only the existing private StoragePort implementation is reusable. There are no static or public object URLs. Incomplete temporary bytes are removed after 24 hours by ownership-checked cleanup. A failed attachment does not roll back the Inquiry or prior attachments.

New public files start QUARANTINED. Only the configured malware-scanner integration may move a file to CLEAN or REJECTED. Without an operational scanner, the contract fails closed: files remain unavailable for download and R1-011 extraction. Structural MIME checks are not a malware verdict. Download requires inquiry visibility plus both document permissions and CLEAN state, streams through NestJS with no-store/nosniff and attachment disposition, and never returns storage keys. File formats, final quotas, scan service and completed-file retention remain OD-010-03/launch gates.

## Anti-abuse and privacy defaults

Recommended starting configuration, not business commitments: public create 5/15 minutes and 20/day per trusted source; upload intent 10/hour and 25 MiB/day of declared bytes per trusted source across all Inquiry IDs; 5 files and 25 MiB actual completed bytes per Inquiry; 10 MiB per file; 2 MiB create JSON request; 50 equipment lines; 30-minute intent start lifetime; 15-minute active stream deadline; 24-hour cleanup for incomplete bytes; 30-day idempotency retention. Same-key intent retry does not charge the daily source budget twice; cancelled, failed or expired intents are not refunded during that UTC day. Values are configurable and have explicit tests. Counters live in Redis; reuse the existing R1-002 `RATE_LIMIT_KEY` with an Inquiry-specific HMAC namespace and no new secret. Trust forwarded source headers only from the explicitly configured reverse proxy hop; otherwise use the direct peer. Never trust arbitrary X-Forwarded-For. If Redis or required private storage is unavailable, reject public writes with a safe 503.

Require exact configured Origin on public browser writes and disable credentialed wildcard CORS. Public writes do not use cookies, so no ambient browser authority is granted. Staff writes follow the exact FROZEN R1-002 session-cookie, CSRF and Origin policy. Logs, traces and AuditEvent exclude request bodies, PII, raw IP, capability, filenames, file bytes, comments, storage keys and exception payloads. Public errors do not reveal Inquiry existence or internal dependency details.

The exact legal basis, text/checkbox, consent evidence, retention/deletion and commercial launch gate are not inferred; they require OD-010-02 and legal review. No production collection is authorized by this proposal.

## Approval gate

Owner approval is required for the proposed schema, all 15 operations, nine permission codes and OD-010-01…05 before any migration or API implementation. This package is not FROZEN and confers no production authorization.
