# R1-010 Owner Decisions — FROZEN 1.0.2

**Status:** FROZEN 1.0.2. OD-010-01…05 were approved by the owner for the exact proposal SHA recorded below. Contract Amendment 01 and its owner-approved refinements are recorded below. This packet does not reopen decisions 1–108.

**Owner approval:** received for the complete OD-010-01…05 package on 2026-10-26 at proposed source SHA `68fb60f87c7821044939dd5d95f8e67e6bb73685`. Approval authorizes isolated R1-010B implementation after contract integration, but not production deployment, production migration, production PII collection, scanner provisioning or real permission grants. See [the frozen checksum manifest](../contracts/R1-010-frozen-manifest.json).

## R1-010 Contract Amendment 01 — FROZEN 1.0.2

**Owner approval:** approved on 2026-10-27 after review of the public receipt/upload locator mismatch and `UploadIntentReceipt.maxBytes` profile ceiling. This amendment is limited to capability-only attachment routes, unique capability-hash lookup, one-way capability revocation, and the OpenAPI maximum matching the server's 50 MiB ENGINEERING_DOCUMENTS profile. The 201 create receipt remains exactly `publicReference`, `createdAt` and `message`; `publicReference` is not used to find or authorize an Inquiry.

- `POST /v1/public/inquiry-attachments/upload-intents`
- `PUT /v1/public/inquiry-attachments/upload-intents/{intentId}/content`
- `DELETE /v1/public/inquiry-attachments/upload-intents/{intentId}`

The client sends `X-Inquiry-Upload-Capability` only as a header. The server hashes it with SHA-256, finds exactly one unexpired Inquiry using a unique hash index, then checks the `intentId` belongs to that Inquiry. A missing, invalid, expired or revoked capability and a foreign intent are non-enumerating denials. No public or new staff endpoint is added. A pre-quote staff close already requires `inquiries.transition`, current Inquiry read scope, If-Match and idempotency; this trusted internal path clears both stored hash and expiry in the same locked transaction when a capability remains active, and its existing close AuditEvent lists only the changed field names. This is the only revocation path. The DB rejects hash changes, expiry changes, partial clear, restore and reissue. All intent/upload/cancel operations and idempotency replay fail safely after revoke. A RECEIVING upload rechecks the stored hash under the Inquiry lock before final commit; revoke prevents CONSUMED and document creation, while previously saved originals remain unchanged. Capability expiry still governs stream start, not an already-started stream. The capability is never stored raw or placed in a URL, query, cookie, log, trace or public response. `UploadIntentReceipt.maxBytes` is the minimum of the intent's immutable declared size, selected profile's per-file cap and remaining Inquiry and source/UTC-day byte quotas when the intent is reserved. OpenAPI's hard ceiling is 50 MiB; the client cannot select or expand a profile, and server streaming enforces both this ceiling and the exact declared size. All other OD-010-01…05 behavior, RBAC, lifecycle, personal-data rules, file formats, quarantine, rate limits, idempotency, streaming limits and launch gates remain unchanged.

**Owner-approved refinement (2026-10-27):** only the paired transition `hash != NULL && expiry != NULL` → `hash = NULL && expiry = NULL` is permitted, atomically. It is available only through the authorized internal pre-quote close path; it is audited without capability/hash/expiry values. Any partial clear, key or expiry modification, restoration or reissue is rejected. An upload already in RECEIVING must recheck revocation before finalization and cannot become CONSUMED or create a source document if revoked. Completed originals are retained. The same approval confirms the existing profile limits: MVP_SAFE 10 MiB/file and ENGINEERING_DOCUMENTS 50 MiB/file. `maxBytes` is at most 50 MiB and is bounded per intent by its declared size, selected profile and remaining Inquiry/source-day quotas.

## OD-010-01 — Contact fields and verification

**Question:** Which contact fields are required, and must email/phone be verified before a request is accepted?

**Recommended:** contact person required; at least one of email or phone required; organization and tax identifier optional; preferred channel optional but must correspond to a supplied channel; region/deadline optional. No account or OTP/channel verification in R1-010. The request is accepted as an unverified customer statement; anti-spam/rate limiting remains mandatory. No contact data is exposed through public APIs after creation.

**Alternative:** verify one selected channel before accepting or require both email and phone. This reduces malformed contacts but adds delivery credentials, latency, abuse surface and recovery policy.

**Owner decision: APPROVED.** Contact name is required; at least one valid email or phone is required; account, OTP and channel verification are not required. Other contact fields remain as specified above.

## OD-010-02 — Personal data, legal notice, consent and retention

**Question:** What legal basis, notice, consent evidence, retention period, deletion/anonymization and legal-hold policy apply to contacts, Inquiry text, comments and attachments?

**Recommended:** no public production collection until legal counsel and owner approve the applicable notice/basis and retention schedule. Store only fields in the approved contract; if consent is selected, record the exact notice version, accepted flag and server time, but do not store raw IP or user-agent as consent proof. Do not claim legal compliance from a checkbox. Keep Inquiry and original files inaccessible to the public; do not silently purge completed source data until the schedule is approved. Set archive/delete automation only in a later approved operation.

**Alternative:** collection under another confirmed legal basis with a separately approved notice and retention policy. A retention period cannot be inferred safely by engineering.

**Launch gate:** commercial public collection and production retention/deletion remain blocked pending written legal/owner approval. The FROZEN schema includes an optional versioned privacyNotice object only to reserve the review point; it is not a launch-ready consent design.

**Owner decision: APPROVED.** No production personal-data collection before separate legal approval of the basis, notice and retention/deletion schedule; a checkbox alone is not legal basis.

## OD-010-03 — Attachment types, quotas, scanner and retention

**Question:** Which source formats and storage limits should anonymous visitors use, and how long may originals be retained?

**Practicality finding:** the earlier single-profile proposal (10 MiB/file, five files, 25 MiB/Inquiry and 25 MiB/source/day) is too restrictive for a shared office source bucket: one maximum-size request consumes the entire daily allowance. A 10 MiB cap can also reject scanned or drawing-heavy PDFs. XLSX specifications usually fit, but may be large when they contain embedded images. The revised proposal therefore separates a bounded default from an explicit engineering-document profile.

**Recommended profiles:**

| Profile                                 | Formats        | Per file | Files / Inquiry | Inquiry total | Source / UTC day | Intent / source / hour | Active stream deadline |
| --------------------------------------- | -------------- | -------: | --------------: | ------------: | ---------------: | ---------------------: | ---------------------: |
| MVP SAFE (default)                      | PDF, CSV, XLSX |   10 MiB |               5 |        25 MiB |          100 MiB |                     10 |                 15 min |
| ENGINEERING DOCUMENTS (explicit opt-in) | PDF, CSV, XLSX |   50 MiB |              20 |       250 MiB |            1 GiB |                     40 |                 60 min |

Both keep 5 Inquiry creates/15 minutes and 20/day/source, 2 MiB create JSON, 50 equipment lines, 30-minute intent-start expiry, 24-hour incomplete-byte cleanup and 30-day expired-intent metadata. The capability expiry remains 24 hours. Source quotas charge declared bytes once across Inquiry IDs and do not refund cancelled/failed/expired intents during that UTC day. If profiles differ for the same source/day, the atomic counter keeps the lower cap seen; profile changes never reset or widen a charged bucket before UTC rollover. NAT/VPN users share the source quota and the frozen two-stream-per-source limit. At the frozen caps, one shared source can submit four full Inquiry byte allowances/day; legitimate colleagues can still receive 429 when another person consumes the shared allowance. No bypass or new identity method is introduced.

The machine-readable profile file is `R1-010-inquiry-upload-profiles.json`; profile choice is server config only, persisted on Inquiry, not selectable by anonymous callers. Both profiles match the current PR #18 extension allowlist; that form is only a preview and has no actual upload/size/count enforcement.

**Streaming, memory and storage controls:** never buffer whole requests/files; use backpressured streams with at most 1 MiB application byte buffer per stream. Limit to four active streams/API instance and two/source, with a 60-second idle timeout. Aggregate application payload buffering is at most 4 MiB/process, excluding sockets/TLS/runtime/StoragePort/scanner overhead. The existing private StoragePort must support bounded streaming, exact-owned-object cleanup and capacity monitoring; its implementation and capacity must be runtime-verified before enabling the profile. Redis uses existing R1-002 `RATE_LIMIT_KEY`; no new secret or service. If a real malware scanner or required private StoragePort is unavailable, files remain QUARANTINED and cannot be downloaded; do not claim the files are malware-cleared.

**Format exclusions:** DOCX/DOCM/XLSM, DWG/DXF and ZIP/7Z/RAR are not accepted by either profile. OOXML packages may contain relationships/embedded objects; native CAD adds complex untrusted parsers/references; archives add traversal, encryption and decompression risks. Supporting any later requires an approved signature/content validation, operational scanner, quarantine and safe attachment-download strategy; archives additionally need bounded extraction review. PDF/CSV/XLSX are also untrusted and remain QUARANTINED until a real configured scanner marks CLEAN. No scanner exists by assumption; without one, staff download and R1-011 extraction stay disabled.

**Practicality:** the two profiles can accept cabinet documentation as PDF plot/export plus CSV/XLSX schedules within their bounds. They do not accept native CAD/archive packages, and without an operational scanner staff cannot inspect even accepted files. Thus R1-010 can record the request and quarantine bytes, but cannot complete document-led cabinet fabrication intake while no scanner is available; R1-010 is not a manufacturing/production workflow.

**Runtime fixtures required in R1-010B:** benign PDF drawings (including a generated profile-sized streamed fixture), CSV schedules, XLSX specifications with representative workbook features, exact-limit and one-byte-over cases, max file-count/aggregate reservations under races, bounded-memory/backpressure, four concurrent streams, slow/idle streams with injected short clocks, shared-NAT multi-Inquiry source quotas and profile-cap decrease, malformed/signature-mismatched and ZIP-bomb-like XLSX, rejected DOCX/DWG/DXF/archives, scanner CLEAN/REJECTED/absent/timeout/error and StoragePort outage/interruption/exact-owned cleanup. Use generated fixtures, not customer documents. Do not wait 15/60 real minutes; inject time for configured deadline semantics.

**Owner decision: APPROVED.** Both profiles, shared-NAT effects, declared-byte accounting, scanner requirement, 15/60-minute receiving deadlines and future-format gates are frozen as stated above. Completed-file retention remains blocked by OD-010-02/legal approval. R1-006 staff import remains unchanged.

## OD-010-04 — Inquiry taxonomy, lifecycle and stage deadlines

**Question:** Confirm the single process and required fields for EQUIPMENT, PANELS and ENGINEERING, including transition/closure guards, assignment removal policy and current-stage due dates.

**Recommended:**

- EQUIPMENT: one to 50 lines; title, positive decimal quantity string and unit required; SKU, manufacturer, modification, notes and untrusted per-line catalog slug optional. The current PR #18 renders one blank row initially and does not enforce the 50-line ceiling.
- PANELS: `requestType` is required and maps `project-ready` → PROJECT_READY, `typical-change` → MODIFY_TYPICAL, `new-design` → DEVELOP_FROM_BRIEF. Non-empty task/description is required; cabinet purpose and positive quantity are optional; requirements is optional free text; requested work/services is an optional list; documentation availability and notes are optional. This preserves the three current preview choices without requiring fields the UI does not collect.
- ENGINEERING: only non-empty technical task/subject is required. Direction/service area, system/object, expected outcomes, source-document description, scope and notes are optional bounded text. There is no inferred engineering approval or parsing.
- Contact: backend requires a contact name and at least one valid email or phone under approved OD-010-01. PR #18 currently leaves all contact fields optional in local validation; integration must add required validation before enabling submit. Desired deadline is preserved as optional free text, not parsed into a date. Optional customer comment is retained in the immutable private contact snapshot.
- Preserve exact submitted wording. No SKU matching, automatic analogues, BOM, costing or approval.
- The FROZEN transition table in R1-010-inquiry-state-machine.md includes TRIAGE direct to ENGINEERING_REVIEW, staff recording received clarification, and controlled pre-quote closure. The model keeps one terminal CLOSED state and requires `reasonCode` DUPLICATE, CUSTOMER_WITHDRAWN, OUT_OF_SCOPE, SPAM or NOT_FEASIBLE from NEW, TRIAGE, NEEDS_CLARIFICATION, ENGINEERING_REVIEW or READY_FOR_QUOTE. It requires inquiries.transition, current effective read scope (read_all for unassigned NEW), If-Match, durable idempotency and same-transaction state/audit. It is terminal, remains visible in authorized history, preserves the original submission, creates no quote/order and cannot close QUOTE_SENT; QUOTE_SENT still needs an approved sent quote and only quote lifecycle may close it. Assignments still cannot be cleared; they may be replaced with another eligible ACTIVE employee.
- Confirm one optional human-managed `stageDueAt` for the current stage, visible to authorized staff and set/cleared through a separate audited OCC command. A successful stage transition clears it. It is distinct from the customer's `desiredDeadline`; no automatic SLA calculation or notification is introduced.

The detailed compatibility matrix is in the review-verification report. PR #18 remains preview-only: submit is disabled, selected files are represented only by local metadata, no request/capability/intent/byte upload reaches this API, and there is no integration claim. The contract PR does not change PR #18. Before future API activation, the frontend must enforce contact name plus email-or-phone, cap equipment lines at 50, map the three panel identifiers, map task/subject into the required API fields, and submit the optional product hint only as `catalogProductContext` (untrusted context).

**Owner decision: APPROVED.** The recommended request fields, compatibility mappings, lifecycle transitions, closure guards, assignment rules and stage-deadline semantics above are frozen; no unlisted fields or automation are added.

**Alternative (not selected):** specify other kind-specific choices or required fields as one consolidated list. New kinds or lifecycle branches require explicit contract update.

## OD-010-05 — Receipt, reference and notifications

**Question:** Confirm successful response semantics, the customer-facing reference and notification behavior.

**Recommended:** return 201 Created only after durable synchronous commit; include a random opaque 20–32 character publicReference, server timestamp and neutral acknowledgement; never provide status lookup or treat the reference as a credential; do not promise response time. R1-010B stores the inquiry durably and emits no external delivery itself. A later notification integration must run after commit and may never roll back or change the committed Inquiry; notification delivery/retry is owned by R1-017.

**Alternative:** return 202 only if acceptance itself is asynchronous and may remain uncommitted/awaiting processing. A sequential or guessable reference is rejected. Owner may approve future channel(s) under R1-017 but no provider is introduced here.

**Owner decision: APPROVED.** R1-010B returns synchronous 201 only after durable commit and sends no external notifications. This preserves the R1-017 notification requirement for a later stage.

## Approval wording

> Owner approval received: “Утверждаю R1-010 Public Inquiry Domain Contract версии 0.1.0-proposed на SHA `68fb60f87c7821044939dd5d95f8e67e6bb73685`. Принимаю OD-010-01…05 в редакциях `docs/plans/R1-010-owner-decisions.md`.” The owner additionally confirmed all listed rules and explicit production exclusions in the approval message on 2026-10-26.
>
> - **OD-010-01:** контактное лицо обязательно; нужен хотя бы один корректный email или телефон; проверка канала не выполняется; организация, ИНН, канал, регион, срок и комментарий необязательны.
> - **OD-010-02:** производственный сбор персональных данных запрещён до утверждения юридического основания, уведомления и сроков хранения/удаления; чекбокс сам по себе не считается правовым основанием.
> - **OD-010-03:** серверный профиль по умолчанию MVP_SAFE: PDF/CSV/XLSX, 10 MiB/файл, 5 файлов и 25 MiB/заявка, 100 MiB/источник/UTC-день и 10 intent starts/источник/час. ENGINEERING_DOCUMENTS — явный серверный opt-in: те же форматы, 50 MiB/файл, 20 файлов и 250 MiB/заявка, 1 GiB/источник/UTC-день и 40 intent starts/источник/час. Оба профиля: создание 5 заявок/15 минут и 20/день/источник; NAT/VPN делит квоты; 1 MiB application buffer/stream, четыре потока/API process, два/источник, 60 секунд idle timeout, receiving deadline 15/60 минут. Для скачивания необходимы работающие scanner и существующий private StoragePort; без scanner файлы остаются QUARANTINED, без скачивания/извлечения. DOCX, DWG/DXF и архивы исключены до отдельного решения.
> - **OD-010-04:** EQUIPMENT — 1–50 строк с обязательными наименованием, положительным строковым количеством и единицей; PANELS требует тип и непустое описание задачи; ENGINEERING требует только непустое техническое задание; остальные kind-specific поля необязательны и ограничены OpenAPI. Досрочное закрытие без КП — один терминальный CLOSED, обязательный reasonCode DUPLICATE/CUSTOMER_WITHDRAWN/OUT_OF_SCOPE/SPAM/NOT_FEASIBLE, только из NEW/TRIAGE/NEEDS_CLARIFICATION/ENGINEERING_REVIEW/READY_FOR_QUOTE; actor требует `inquiries.transition` и текущий read scope (для unassigned NEW — `inquiries.read_all`). Используются If-Match, durable idempotency, row lock и одна транзакция для состояния, версии, AuditEvent и receipt. Исходная заявка неизменна, CLOSED виден в staff-истории и не переоткрывается; КП/заказ не создаются. QUOTE_SENT требует утверждённое и отправленное КП; закрытие QUOTE_SENT принадлежит quote lifecycle. `stageDueAt` задаёт сотрудник вручную; успешный переход его очищает; автоматические SLA/уведомления отсутствуют.
> - **OD-010-05:** синхронный 201 только после durable commit; непредсказуемая ссылка не даёт публичного чтения статуса; нейтральное подтверждение, без внешней рассылки в R1-010.
>
> Пакет содержит шесть таблиц, 15 операций OpenAPI, девять additive permissions и REQB-01…41.

Approval freezes the contract only. It authorizes preparation of R1-010B implementation after integration, but not production migration, deployment, production data collection, scanner provisioning or real permission grants.
