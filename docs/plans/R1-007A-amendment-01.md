# R1-007A Owner Clarification 01

**Status:** OWNER APPROVED — applies narrowly to FROZEN R1-007A 1.0.0.

The owner chose **“Change unlink response to receipt”** after implementation review identified that the original unlink response described a full Offer containing purchase cost, while OD-007A-07 forbids purchase cost in persisted idempotency responses and requires exact replay.

For `POST /v1/staff/supplier-offers/{offerId}/match/unlink` (`unlinkSupplierOfferMatch`), return the dedicated sanitized `OfferUnlinkMutationReceipt` containing only `id` and `version`. Persist and replay that same receipt in `SupplierCommandIdempotency`. Do not return the full Offer or purchase cost from this mutation. The separately authorized offer read remains the path for private Offer data.

This clarification changes only the unlink mutation response schema. It does not change any table, permission, lifecycle rule, audit rule, matching rule, or response for other operations. The original owner approval source remains `241b9c1a6d6e57b7ff1999e1aae46b66c33cb131`.
