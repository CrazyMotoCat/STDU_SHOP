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

`APPROVED` and `REJECTED` are terminal historical decisions. There is no bulk command, reverse transition, `SUPERSEDED` state, or second approval of a rejected proposal. Approving a replacement proposal changes the offer's single current-proposal pointer atomically; prior proposals remain as recorded. Explicit unlink clears that pointer and records a reason/audit event without changing proposal history.

Proposal approval is allowed only when the proposal still references the offer's current identity tuple and an eligible CatalogProduct whose current identity tuple exactly matches its saved snapshot. Otherwise it fails with a conflict and no partial change.

## Derived effective association

The current pointer is effectively `CURRENT` only while offer and product identities continue to match the snapshots in the selected approved proposal. Identity changes produce a derived `REVIEW_REQUIRED` result; they do not silently reassign a product, mutate an old proposal or make it eligible for costing. No selected proposal means `UNMATCHED`. This result is calculated from persisted facts, not stored as an additional proposal state.

## Transaction/idempotency rules

- Supplier/offer create, edit, archive, offer revision append, proposal create, approve/reject and unlink use expected root/proposal versions.
- A decision command includes `Idempotency-Key`; same key and same canonical payload replays the original result, including a previous rejection. Reuse with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`.
- The decision locks the offer, proposal and product, validates all versions, active states, current pointer and identity snapshots, then writes pointer/decision and AuditEvent in one PostgreSQL transaction.
- A stale version, missing exact identity, inactive root or terminal proposal returns a defined error; no domain mutation or success audit is committed.
