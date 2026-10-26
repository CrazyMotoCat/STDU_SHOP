# R1-010 Owner Decisions — PROPOSED 0.1.0

Status: all listed items require owner approval before R1-010 implementation. Technical values below are recommendations, not frozen behavior. This packet does not reopen decisions 1–108.

## OD-010-01 — Contact fields and verification

**Question:** Which contact fields are required, and must email/phone be verified before a request is accepted?

**Recommended:** contact person required; at least one of email or phone required; organization and tax identifier optional; preferred channel optional but must correspond to a supplied channel; region/deadline optional. No account or OTP/channel verification in R1-010. The request is accepted as an unverified customer statement; anti-spam/rate limiting remains mandatory. No contact data is exposed through public APIs after creation.

**Alternative:** verify one selected channel before accepting or require both email and phone. This reduces malformed contacts but adds delivery credentials, latency, abuse surface and recovery policy.

**Owner choice:** accept recommendation or list fields and verification rule changes. No outbound verification provider is assumed.

## OD-010-02 — Personal data, legal notice, consent and retention

**Question:** What legal basis, notice, consent evidence, retention period, deletion/anonymization and legal-hold policy apply to contacts, Inquiry text, comments and attachments?

**Recommended:** no public production collection until legal counsel and owner approve the applicable notice/basis and retention schedule. Store only fields in the approved contract; if consent is selected, record the exact notice version, accepted flag and server time, but do not store raw IP or user-agent as consent proof. Do not claim legal compliance from a checkbox. Keep Inquiry and original files inaccessible to the public; do not silently purge completed source data until the schedule is approved. Set archive/delete automation only in a later approved operation.

**Alternative:** collection under another confirmed legal basis with a separately approved notice and retention policy. A retention period cannot be inferred safely by engineering.

**Launch gate:** commercial public collection and production retention/deletion remain blocked pending written legal/owner approval. The PROPOSED schema includes an optional versioned privacyNotice object only to reserve the review point; it is not a launch-ready consent design.

## OD-010-03 — Attachment types, quotas, scanner and retention

**Question:** Which source formats and storage limits should anonymous visitors use, and how long may originals be retained?

**Recommended initial allowlist:** PDF, CSV, XLSX, JPEG and PNG; reject ZIP, macro-enabled Office, HTML/SVG, executables and CAD formats. Do not extract/parse in R1-010. Per file <=10 MiB, <=5 files and <=25 MiB actual stored bytes per Inquiry; create JSON <=2 MiB and at most 50 equipment lines. One-use upload intent can start within 30 minutes; once started, a stream has at most 15 minutes to finish. The inquiry-bound upload capability expires after 24 hours. Per-source 25 MiB/day uses atomically charged declared bytes across Inquiry IDs; cancelled/failed/expired intents are not refunded during that UTC day. Clean stale temporary byte streams after 24 hours and expired intent metadata after 30 days. Completed file retention is an OD-010-02 legal decision.

**Scanner rule:** no malware scan is implied by MIME/signature validation. Recommend fail-closed QUARANTINED until an operational scanner is approved and configured. Only that scanner can mark CLEAN. If the scanner is unavailable, download and R1-011 extraction remain disabled; do not invent a scanner service or credentials.

**Owner choice:** approve/adjust formats, byte-counting rule, limits and stream timeout, scanner availability/launch gate and retention. Representative file runtime tests in R1-010B must confirm the 15-minute active-stream bound is practical. R1-006 staff-import remains unchanged.

## OD-010-04 — Inquiry taxonomy, lifecycle and stage deadlines

**Question:** Confirm the single process and required fields for EQUIPMENT, PANELS and ENGINEERING, including transition/closure guards, assignment removal policy and current-stage due dates.

**Recommended:**

- EQUIPMENT: one to 50 lines; title, positive decimal quantity string and unit required; SKU, manufacturer, modification, notes and untrusted catalog slug optional.
- PANELS: request type PROJECT_READY/MODIFY_TYPICAL/DEVELOP_FROM_BRIEF, cabinet purpose and positive quantity required; requirements/work list/description optional. These identifiers match the current R1-010A proposal while preserving the task's three semantic choices.
- ENGINEERING: direction, system type, technical task and at least one expected deliverable required; deadline optional.
- Preserve exact submitted wording. No SKU matching, automatic analogues, BOM, costing or approval.
- Confirm the transition table in R1-010-inquiry-state-machine.md, including TRIAGE direct to ENGINEERING_REVIEW, staff recording received clarification, and QUOTE_SENT/CLOSED only through later quote lifecycle. The proposed contract does not permit pre-quote closure (such as duplicate closure) or clearing assignments; assignments can be replaced with another eligible ACTIVE employee.
- Confirm one optional human-managed `stageDueAt` for the current stage, visible to authorized staff and set/cleared through a separate audited OCC command. A successful stage transition clears it. It is distinct from the customer's `desiredDeadline`; no automatic SLA calculation or notification is introduced.

**Alternative:** specify other kind-specific choices or required fields as one consolidated list. New kinds or lifecycle branches require explicit contract update.

## OD-010-05 — Receipt, reference and notifications

**Question:** Confirm successful response semantics, the customer-facing reference and notification behavior.

**Recommended:** return 201 Created only after durable synchronous commit; include a random opaque 20–32 character publicReference, server timestamp and neutral acknowledgement; never provide status lookup or treat the reference as a credential; do not promise response time. R1-010B stores the inquiry durably and emits no external delivery itself. A later notification integration must run after commit and may never roll back or change the committed Inquiry; notification delivery/retry is owned by R1-017.

**Alternative:** return 202 only if acceptance itself is asynchronous and may remain uncommitted/awaiting processing. A sequential or guessable reference is rejected. Owner may approve future channel(s) under R1-017 but no provider is introduced here.

**Owner choice:** accept 201 and no outbound notification in R1-010B, or record one precise alternative. This differs from the R1-010A proposal's suggested 202; rationale is that this contract persists the Inquiry before replying. It does not remove the R1-017 notification requirement from the full R1 roadmap.

## Approval wording

> Утверждаю R1-010 Public Inquiry Domain Contract версии 0.1.0-proposed на SHA `<полный SHA после финальных проверок>`, включая модель данных, 15 операций OpenAPI, девять permissions, state machine, политику файлов и OD-010-01…05 с указанными ответами.

Approval freezes the contract only. It authorizes preparation of R1-010B implementation after integration, but not production migration, deployment, production data collection, scanner provisioning or real permission grants.
