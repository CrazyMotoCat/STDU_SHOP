# R1-010B-01 Contract Preparation & Verification

**Status:** PROPOSED / REVIEW_REQUIRED; stop at owner approval.
**Baseline:** `6b9f03e67f51f8e201a04047afd282c71b1d335e`.
**Comparison input:** open Draft PR #18, HEAD `644a9ad9e72c98cd07c1914bd5c2f2d38e690944`; read only.
**Implementation/migrations:** not started and not authorized before owner approval.

## Scope and sources checked

Reviewed REQ-01…04 and CAT-01/03/07 in `docs/spec/03_MASTER_TZ_R1.md`; Inquiry/SourceDocument model and lifecycle in `docs/spec/05_DOMAIN_MODEL.md`; project API sketch in `docs/spec/06_API_CONTRACTS.md`; security and file rules in `docs/spec/07_SECURITY_OPERATIONS.md`; E2E/test guidance in `docs/spec/08_TESTS_AND_ACCEPTANCE.md`; R1 boundary and sequencing in `docs/spec/02_RELEASE_SCOPE.md` and `docs/spec/09_ROADMAP_BACKLOG.md`; inquiry/privacy/file/notification decisions in `docs/spec/01_DECISION_REGISTER.md`; FROZEN R1-002 file/auth contracts and R1-006A private import contract. No source-of-truth spec or FROZEN contract was edited.

## R1-010A read-only comparison

| Area                   | PR #18 proposal                                                          | R1-010B-01 proposal                                                                                                                         | Status                                                              |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Unified subject        | Equipment, panels, engineering; no orders, pricing, analogues or parsing | Same single Inquiry aggregate and boundaries                                                                                                | Aligned                                                             |
| Contact                | Requiredness and verification unresolved                                 | Recommends name + at least one email/phone; no OTP                                                                                          | Owner decision OD-010-01                                            |
| Panel request taxonomy | PROJECT_READY / MODIFY_TYPICAL / DEVELOP_FROM_BRIEF                      | Uses the same identifiers and three semantic choices                                                                                        | Aligned                                                             |
| Create response        | Suggests 202 with opaque receipt                                         | Recommends 201 only after durable synchronous commit                                                                                        | OD-010-05; rationale recorded                                       |
| Upload authorization   | Server-issued one-use intent, inquiry/file-bound                         | One-use intent plus client-generated 256-bit attachment-only capability stored as SHA-256; create JSON then dedicated header for follow-ups | Security design to approve; capability grants no read/status access |
| Upload completion      | Optional attachment/finalization endpoint                                | Streaming PUT consumes the intent atomically; retry requires a new intent                                                                   | One precise proposed flow; owner/security review required           |
| File state             | Private, verified and scanned/quarantined                                | QUARANTINED by default; scanner absent means fail closed, no download/extraction                                                            | Owner/infra decision OD-010-03                                      |
| Notifications          | No provider or delivery promise in proposal                              | R1-010B has no provider; later R1-017 delivery runs after commit and cannot roll back Inquiry                                               | Preserves roadmap E2E-18 and REQB-14 boundary                       |
| Staff data             | Protected queue/detail and internal comments                             | Permission-scoped API, separate PII/doc permissions, default deny                                                                           | New additive permission set requires owner approval                 |

No changes were made to PR #18, its branch or proposal file. PR #18 remains Draft and owned by the parallel frontend workstream.

## Specification ambiguity and proposed resolution

1. `05_DOMAIN_MODEL.md` draws a linear NEW → TRIAGE → NEEDS_CLARIFICATION → ENGINEERING_REVIEW path, while REQ-02 and the task express clarification and engineering review as branches. The proposed state machine permits TRIAGE to either branch and records clarification loops; OD-010-04 must approve these exact transitions.
2. Existing R1-002 FileObject/FileVersion has mandatory staff ownership and UNCHECKED-only versions; R1-006A is staff catalog import. Reusing those rows for anonymous Inquiry sources would violate their frozen ownership contract. The proposal reuses only the existing private StoragePort implementation and adds a separately typed InquirySourceDocument/intent boundary. No frozen table is modified.
3. `02_RELEASE_SCOPE.md` includes inquiry notifications and E2E-18 expects notification-failure resilience; `09_ROADMAP_BACKLOG.md` assigns delivery/retry to R1-017. R1-010B-01 therefore freezes no provider: Inquiry commit is independent of later after-commit notification delivery, and the E2E-18 delivery/retry acceptance remains R1-017.
4. R1-010A suggests 202, while the proposed endpoint transaction is synchronous. 201 is the recommended semantically exact response; OD-010-05 resolves owner preference.
5. REQ-03 and the domain sketch include a stage due date. The proposed contract exposes optional staff-managed `stageDueAt`, distinct from the customer's requested deadline. It uses existing transition permission, OCC and audit; no SLA or notification automation is introduced. OD-010-04 asks the owner to confirm this boundary.

These are contract questions, not modifications to decisions 1–108.

## Proposed package counts

- Six new PostgreSQL tables: Inquiry, InquiryLine, InquiryComment, InquirySourceDocument, InquiryUploadIntent, InquiryCommandIdempotency.
- Fifteen OpenAPI operations: four public and eleven staff, including an audited current-stage due-date command. No public Inquiry read/status route.
- Nine additive permissions, default-deny, with no automatic role grants.
- Existing AuditEvent is extended through a proposed action/entity registry. No separate service/event bus/outbox is added in R1-010B-01.

## Requirement traceability

| Source acceptance                       | Proposed rule / contract                                                                                               | Permissions / state                                                                     | Contract test cases      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| REQ-01, CAT-01, CAT-03, CAT-07          | Single anonymous create; three typed request shapes; original wording; no registration/pricing/order/analogue          | Public create only; NEW is server-assigned                                              | REQB-01…04, 05…07, 25…26 |
| REQ-02                                  | Explicit state machine, manager/engineer assignment, reasoned clarification loops, quote-send integration boundary     | inquiries.assign_manager, inquiries.assign_engineer, inquiries.transition; OCC/If-Match | REQB-11, 26              |
| REQ-03                                  | Staff queue/detail, assignment, history/comments and human-managed current-stage due date; no public message/account   | read scope, inquiries.comment/transition; contact/documents separately permissioned     | REQB-12…14, 17…19, 33    |
| REQ-04                                  | Immutable original with uploader/channel, actual size/MIME/SHA, private key, quarantine and separate later extraction  | inquiries.documents.read/download; file scan state gates bytes                          | REQB-08…10, 15…16, 21…24 |
| 07_SECURITY_OPERATIONS / E2E-17, E2E-18 | No public file URL or enumeration; notification failure cannot roll back Inquiry, actual delivery/retry remains R1-017 | default deny, exact Origin/CSRF, safe audit/logging                                     | REQB-07…14, 20, 22, 25   |

No acceptance item introduces a customer order, inventory, production operation, parser/OCR, automatic matching, automatic staff grant or external account system.

## Contract-only checks

- `node docs/contracts/check-R1-010.mjs` — PASS; six new tables, 15 operations (4 public/11 staff), 9 additive permissions, REQB-01…35.
- `node --test docs/contracts/check-R1-010.test.mjs` — PASS, 19/19, including capability transport, current-scope replay authorization, frozen AuditChanges, cross-Inquiry source quota, live-stream expiry, and quote-state target regressions.
- Swagger Parser OpenAPI 3.1 validation — PASS.
- `openapi-typescript` generation and `--check` reproducibility — PASS; generated temporary declaration removed.
- Prettier `--check` — PASS on all task artifacts.
- Independent architecture rereview — PASS; quote/closure target enum, allowed transitions, audit allowlist and stage deadlines are consistent.
- Independent security rereview — PASS; capability/replay authorization, declared-byte quota, live-stream expiry and privacy boundaries have no open findings.
- `git diff --cached --check` on the explicit 15-file task diff — PASS.
- GitHub CI — pending Draft PR; no full local/runtime CI was run in this contract-only phase.

Independent architecture and security reviewers initially reported contract gaps. The package now includes corrections for capability transport, current-scope reauthorization before idempotency replay, separate comment persistence, explicit closure/assignment rules, stage deadline traceability, per-action AuditChanges allowlists, declared-byte source quota semantics, bounded active-stream expiry, and a staff target enum that excludes quote lifecycle states. Both final rereviews are PASS with no actionable findings.

## Owner decisions and remaining risks

OD-010-01…05 are in `R1-010-owner-decisions.md`. Before production use, legal review must set the personal-data basis/notice/retention; owner/infrastructure must approve file types/quotas, declared-byte daily charging, 15-minute active stream timeout and scanner; no scanner means no download or R1-011 extraction. Other open choices are channel verification, taxonomy/transition/closure guards, stage due-date policy, HTTP receipt semantics and later notification channels. No runtime behavior exists yet.
