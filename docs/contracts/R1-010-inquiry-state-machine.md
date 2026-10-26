# R1-010 Inquiry State Machine — PROPOSED 0.1.0

## States and transitions

```text
NEW -> TRIAGE
TRIAGE -> NEEDS_CLARIFICATION | ENGINEERING_REVIEW
NEEDS_CLARIFICATION -> TRIAGE | ENGINEERING_REVIEW
ENGINEERING_REVIEW -> NEEDS_CLARIFICATION | READY_FOR_QUOTE
READY_FOR_QUOTE -> NEEDS_CLARIFICATION | QUOTE_SENT
QUOTE_SENT -> CLOSED (later quote-lifecycle event only)
```

The sequence preserves REQ-02 and the domain model. The shorter branch from TRIAGE directly to ENGINEERING_REVIEW is explicit. Returning to TRIAGE means staff recorded that the requested clarification arrived. Reopening a closed request is not supported in R1. Generic staff transitions cannot set CLOSED; the later quote lifecycle may close only a QUOTE_SENT inquiry. Closing before a quote (for example, as a duplicate) is not defined in this contract. OD-010-04 asks the owner to confirm transition rules, required fields and this closure boundary.

## Authority and guards

| Transition                                | Initiator                             | Required guard                                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NEW -> TRIAGE                             | Staff with inquiries.transition       | Manager is assigned and ACTIVE; If-Match succeeds; reason TRIAGE_STARTED.                                                                                                                                        |
| TRIAGE -> NEEDS_CLARIFICATION             | Staff with inquiries.transition       | Manager assigned; reason MORE_INFORMATION_REQUIRED. This does not send a customer message.                                                                                                                       |
| TRIAGE -> ENGINEERING_REVIEW              | Staff with inquiries.transition       | Active engineer assigned; reason ENGINEERING_STARTED.                                                                                                                                                            |
| NEEDS_CLARIFICATION -> TRIAGE             | Staff with inquiries.transition       | Staff manually records receipt of clarification; reason INFORMATION_RECEIVED. No public/customer callback is introduced.                                                                                         |
| NEEDS_CLARIFICATION -> ENGINEERING_REVIEW | Staff with inquiries.transition       | Active engineer assigned; reason ENGINEERING_STARTED.                                                                                                                                                            |
| ENGINEERING_REVIEW -> NEEDS_CLARIFICATION | Staff with inquiries.transition       | Engineer assignment remains recorded; reason RETURN_TO_CLARIFICATION.                                                                                                                                            |
| ENGINEERING_REVIEW -> READY_FOR_QUOTE     | Staff with inquiries.transition       | Active engineer assigned; reason ENGINEERING_COMPLETE. This means inquiry information is ready for the later quote workflow; it is not an engineering revision approval, costing or quote approval.              |
| READY_FOR_QUOTE -> NEEDS_CLARIFICATION    | Staff with inquiries.transition       | Reason RETURN_TO_CLARIFICATION.                                                                                                                                                                                  |
| READY_FOR_QUOTE -> QUOTE_SENT             | Later quotation delivery command only | A corresponding approved immutable quote revision has been published/sent by R1-015/016; the integration emits the transition in the quote transaction. No direct generic Inquiry transition can set this state. |
| QUOTE_SENT -> CLOSED                      | Later quote-lifecycle event only      | The corresponding approved immutable quote lifecycle emits completion atomically with this transition. R1-010 defines no manual closure reason or direct staff endpoint. No order is created.                    |

Every staff command also requires an effective read scope and the action permission. Public actors have no transition endpoint. Frontend-hidden actions are not authorization.

## Assignment and concurrency

Manager and engineer assignments are separate PATCH commands and permissions. A target must be ACTIVE and have inquiries.read_assigned or inquiries.read_all. Commands assign or replace a target; clearing an assignment is not supported. Assignment changes do not change the Inquiry status. Every assignment command uses a strong If-Match version, a fresh staff/session/RBAC check, one PostgreSQL transaction and one AuditEvent. A stale version returns 409 VERSION_CONFLICT and changes no assignment or success audit.

Transition, assignment and stage-deadline writers lock the Inquiry row, recheck current state and actor permissions after lock acquisition, apply the transition guard, increment version, insert the allowlisted audit event and persist idempotency result in the same transaction. Two concurrent commands cannot both succeed from the same version. A successful status transition clears `stageDueAt`; staff may set or clear the deadline for the current stage through the separately audited stage-deadline command. `stageDueAt` is a human-set internal due date, distinct from a customer's optional `desiredDeadline`; R1 defines no automatic SLA calculation or notification.

Before looking up or returning a saved staff idempotency receipt, the API must revalidate the current session, CSRF/Origin, schema, effective action permission and inquiry read scope. A caller whose assignment/read scope was revoked cannot replay a receipt containing that Inquiry's identifiers. Public upload retries likewise revalidate the current unexpired inquiry-bound capability and intent binding before replay. A failed authorization check does not reveal the saved result. Public create retries need no inquiry-read authority because their response is only the original non-authorizing receipt.

Comments are append-only INTERNAL rows. Comment creation does not mutate the aggregate version; it requires inquiries.comment, inquiry read scope, CSRF/Origin and Idempotency-Key, and writes its row and audit atomically. Public messages are not supported. TransitionRequest has no free-text internalNote: reasonCode is the bounded audit reason, and any contextual staff note must be submitted separately through the comment command under inquiries.comment. Comments are not implicitly created by transitions.

## History

The existing R1-002 AuditEvent is the authoritative state/assignment/stage-deadline history, ordered by occurredAt then id. InquiryComment is the separate internal content store; AuditEvent records the comment event but never the comment body. State duration is derived from successful transition event timestamps. No parallel event-history store is added.
