# R1-010 Public Inquiry Contract Proposal

**Status:** proposal for owner and contract review; not a frozen contract and not implemented API. This document does not amend OpenAPI, Prisma, RBAC, or decisions 1–108. Backend implementation belongs to R1-010B after approval.

## Scope and invariants

One anonymous `Inquiry` workflow serves equipment, panels, and engineering requests. It must not create a customer order, calculate a price, promise a response time, choose technical substitutes, parse a specification, or expose staff-only data. The original source files remain immutable after secure server-side receipt; extraction is a later R1-011 concern and matching/review are R1-012/R1-013.

## Proposed inquiry shape

- `kind`: `EQUIPMENT | PANELS | ENGINEERING`.
- `contactSnapshot`: contact person, optional organization, email, phone, preferred channel, region, desired timing, and comment. Email/phone requiredness and contact verification are unresolved (see Owner Decisions).
- `equipment.lines[]`: `rawTitle`, optional manufacturer, original SKU/article, modification, decimal quantity, unit, and note. Preserve raw customer wording. Optional `productContext` contains a client-supplied catalog slug only as an untrusted hint; the server must resolve and validate it before any association. It never authorizes an SKU match.
- `panels`: request type `PROJECT_READY | MODIFY_TYPICAL | DEVELOP_FROM_BRIEF`, purpose, task description, requirements, documentation state, requested services, cabinet quantity, desired timing, and notes. This is a request description, not a BOM/configurator.
- `engineering`: object/system, work subject, requested service areas, source-document description, scope, expected deliverables, desired timing, and comments.
- `attachments[]`: immutable `SourceDocument` records with original name, verified MIME/content type, size, checksum, upload channel/uploader, quarantine state, and processing record, per REQ-04. Never treat the browser filename or MIME header as trusted evidence.

## Lifecycle proposal

Retain the approved domain sequence: `NEW → TRIAGE → NEEDS_CLARIFICATION / ENGINEERING_REVIEW → READY_FOR_QUOTE → QUOTE_SENT → CLOSED`. Exact transition permissions, assignment, staff SLA, and notification behavior remain server-owned and must not be inferred by the public client. Rejected, duplicate, spam, and abandoned-upload handling should be separately auditable without erasing accepted inquiry history.

## API sketches (not approved)

1. `POST /v1/public/inquiries` accepts a versioned DTO and an idempotency key. Suggested success: `202 Accepted` with an opaque public reference, current public-safe receipt state, and timestamp. Do not return internal IDs, staff fields, costs, parsing data, or status-transition controls. The response must not promise email delivery or a response time unless approved.
2. For each attachment, the server issues a short-lived, one-use upload intent bound to the accepted inquiry and a single declared file: `POST /v1/public/inquiries/{id}/attachments/upload-intents`. The upload is private, content-verified, size-limited, malware-scanned/quarantined, and finalized server-side before it is visible to staff. The intent is not a public storage URL and cannot be reused for another inquiry or object.
3. Expired/failed intent handling returns a stable, safe error code and permits an explicit retry with a new intent. Retry must not duplicate an accepted file. An inquiry registration retry with the same idempotency key and payload returns the same receipt; a conflicting payload returns a conflict response without creating a second inquiry.

The source API sketch also lists `POST /v1/public/inquiries/{id}/attachments`; retain it only if the approved upload-intent design needs a finalization endpoint. Registration and attachment upload must not be represented as atomic when they are separate operations.

## Abuse controls and privacy

Apply server-side per-IP and per-session/request rate limits, anti-automation controls, CSRF/Origin policy where applicable, request-size limits, idempotency retention, and safe structured error responses. Thresholds, challenge behavior, retention, and any verification channel require security/legal review before implementation. Do not put PII, file contents, tokens, or full inquiry bodies in URLs, analytics, or logs. Store files privately, validate actual content, quarantine before staff download/use, and retain original bytes immutably. The browser preview must not persist draft data or upload files.

## Future Staff UI

Provide a role-protected inquiry queue and detail view with assignment, status history, public fields, attachment quarantine/scan state, and audit events. Separate customer-visible messages from internal comments. Engineers and managers act only through server-authorized transitions; frontend visibility is not authorization. Do not edit supplier-domain screens as part of this proposal.

## Minimum Owner Decisions

1. **Contact rule:** which of name, email, and phone is required; whether at least one verified channel is required; and which preferred-channel values are supported.
2. **Privacy/legal copy:** approve the public privacy notice/consent wording, record of acceptance if needed, retention period, and contact-verification expectations before launch.
3. **Attachment policy:** approve accepted extensions/content formats beyond XLSX/CSV/PDF, per-file and total size/count limits, retention, and whether an inquiry can be registered before all uploads finish.
4. **Request taxonomy and receipt:** approve panel request/service option identifiers and whether the public success receipt uses an opaque reference only or also sends a notification. Approve any customer-facing status wording; no response-time promise is assumed.

Security engineering should propose rate-limit, challenge, idempotency-expiry, upload-intent lifetime, malware-scanning, and safe retry parameters during R1-010B; this frontend task does not make them business rules.

## R1-010A preview boundary

The unlinked `/request-quote` route is always `noindex`. Its interactive preview is enabled in development or in a server environment explicitly setting `RFQ_PREVIEW_ENABLED=true`; otherwise production renders an unavailable notice. Local validation and review use page memory only. The browser makes no inquiry or upload request, uses no browser storage or analytics, and keeps the send control disabled.
