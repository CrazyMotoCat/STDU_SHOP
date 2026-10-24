# R1-007 Supplier State Machine — Proposed 0.1.0

## Supplier

`ACTIVE → ARCHIVED` is a one-way, versioned, reasoned and audited transition. No restore or hard delete is proposed. Archive blocks creation/editing of offers, leaves all prior history readable under permissions and removes the supplier's offers from current comparison results. Archiving does not cascade to offers.

## SupplierOffer

`ACTIVE → ARCHIVED` is a one-way transition with OCC and audit. No hard delete or restore. Archived offers remain readable as history and are excluded from current comparison/costing candidates. SupplierOffer content changes append an immutable revision while the root remains ACTIVE; revision content has no mutable status. Root archive does not edit or erase revisions or decisions.

## Freshness (derived)

| Condition                                                                | Derived value |
| ------------------------------------------------------------------------ | ------------- |
| Explicit `expiresAt <= now`                                              | `STALE`       |
| Explicit `expiresAt > now`                                               | `CURRENT`     |
| No expiry; configured freshness window and `referenceAt + window <= now` | `STALE`       |
| No expiry; configured window and before cutoff                           | `CURRENT`     |
| No expiry and no configured window                                       | `UNKNOWN`     |

`referenceAt = sourceObservedAt ?? recordedAt`. No stale revision is deleted or replaced. Staleness never publishes or updates public catalog price.

## ProductMatchProposal

```text
PENDING ── approve (one proposal, current identity exact) ──> APPROVED
   └────── reject (one proposal) ──────────────────────────> REJECTED
```

`APPROVED` and `REJECTED` are terminal historical decisions. There is no bulk command, reverse transition, `SUPERSEDED` state, or second approval of a rejected proposal. A partial unique index allows at most one `PENDING` proposal for `(offerId, offerRevisionId, proposedProductId)`; terminal historical rows do not prevent a new proposal with a new ID for that same tuple. Every new proposal is individually created and audited. Approving a replacement proposal changes the offer's single current-proposal pointer atomically; prior proposals remain as recorded. Explicit unlink clears that pointer and records a reason/audit event without changing proposal history and never restores an older pointer automatically. Repeating the original command with its original key replays its stored response instead of creating another proposal.

Proposal approval is allowed only when the proposal still references the offer's current identity tuple and an eligible CatalogProduct whose current identity tuple exactly matches its saved snapshot. Otherwise it fails with a conflict and no partial change.

## Derived effective association

The current pointer is effectively `CURRENT` only while offer and product identities continue to match the snapshots in the selected approved proposal. Identity changes produce a derived `REVIEW_REQUIRED` result; they do not silently reassign a product, mutate an old proposal or make it eligible for costing. No selected proposal means `UNMATCHED`. This result is calculated from persisted facts, not stored as an additional proposal state.

## Transaction/idempotency rules

- Supplier/offer create, edit, archive, offer revision append, proposal create, approve/reject and unlink use expected root/proposal versions.
- Every R1-007 mutation includes the existing OpenAPI `Idempotency-Key` string of 8–128 characters. Durable scope is `(actorStaffUserId, 'R1-007', exact key value)` across mutation operations. SHA-256 hashes RFC 8785 canonical JSON of API version, operationId, HTTP method, normalized path/query, actor and validated request DTO, including expected versions. `SupplierCommandIdempotency` persists the completed status and sanitized response in the same PostgreSQL transaction as the successful domain write and AuditEvent; deterministic terminal OCC/domain conflicts are persisted without a domain write or success AuditEvent. Same-key/same-hash retries, including after API restart, replay the exact saved response. Same-key/different-hash returns `409 IDEMPOTENCY_KEY_REUSED`. A caller correcting a stale expected version or changing a payload must use a new key.
- Before reading a saved result, revalidate authentication, current permissions, Origin, CSRF and request schema. Use a PostgreSQL transaction-scoped advisory lock over the actor/scope/key to serialize equal keys, with the unique database constraint as a backstop. Retain idempotency records indefinitely; no cleanup is defined in R1.
- The decision locks the offer, proposal and product, validates all versions, active states, current pointer and identity snapshots, then writes pointer/decision and AuditEvent in one PostgreSQL transaction.
- A stale version, missing exact identity, inactive root or terminal proposal returns a defined error; no domain mutation or success audit is committed.
- `VERSION_CONFLICT` is a saved terminal response for its key. Retrying that same key returns the same 409; submitting a corrected expected version requires a new key.
