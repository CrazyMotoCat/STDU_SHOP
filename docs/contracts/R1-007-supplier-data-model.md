# R1-007 Supplier Data Model — Proposed 0.1.0

## Scope and ownership

The model adds only `Supplier`, immutable `SupplierRevision`, `SupplierOffer`, immutable `SupplierOfferRevision`, and `ProductMatchProposal`. A supplier is an external equipment counterparty. It is never a `SellerLegalEntity` and does not inherit seller tax, bank or quotation authority. The model references the existing `CatalogProduct`, `Brand`, `StaffUser` and `AuditEvent`; it does not duplicate the product catalog or create brands/products.

All IDs are UUIDv4, timestamps are UTC, root mutations use positive `int32 version` compare-and-swap, and foreign keys use `ON DELETE/UPDATE RESTRICT`. There is no hard delete. Every accepted mutation and audit write share one PostgreSQL transaction; audit failure rolls back the domain change.

## Supplier

`Supplier` is the current root with `id`, `legalName`, optional `shortName`, optional tax identifier/jurisdiction, contact name/email/phone/website, private `internalNotes`, state `ACTIVE | ARCHIVED`, `currentRevisionId`, version, created/updated timestamps and staff actor IDs. Every profile create/edit appends a complete immutable `SupplierRevision`; the root's profile projection and pointer change in the same transaction. This allows staff to reconstruct prior contact/requisite/note values without putting those values in the global AuditEvent. Supplier archive is a root state transition and does not fabricate a profile revision. No supplier type is included because no distinct R1 workflow depends on it. Requisites are nullable and never fabricated. Display names and names are not uniqueness keys; no automatic merge/deduplication is performed. Tax-identifier uniqueness is an owner decision in OD-007A-01.

Archiving preserves suppliers, profile and offer revisions, match decisions and audit. An archived supplier cannot receive new offers or profile edits. Existing offers remain readable as history and are excluded from current comparison results. Archive requires OCC and audit; no cascading state change is performed.

## SupplierOffer and revisions

`SupplierOffer` is the stable root: `id`, `supplierId`, `state ACTIVE | ARCHIVED`, `currentRevisionId`, nullable `currentMatchProposalId`, version and actor/timestamp fields. It has **no uniqueness constraint** on supplier/product/part number: distinct commercial offers are not silently merged. Multiple offers from multiple suppliers may link to one product.

Every manual creation or edit appends a complete immutable `SupplierOfferRevision`. The root points to the latest revision; prior values remain queryable. An edit never overwrites source or price history. A revision contains:

- nullable `supplierPartNumber` (supplier's own SKU; not the manufacturer's original part number), `offerName`, `sourceBrandText`, `brandId` (nullable explicit selection of an existing ACTIVE R1-004 Brand), `manufacturerName`, `originalPartNumber`, `modification`, and `modificationEvidence`;
- nullable `purchaseCost` as exact decimal; nullable uppercase ISO-4217 `currency`, required whenever cost is present;
- nullable source VAT text, availability text, lead-time text, source-observed timestamp, explicit `expiresAt`, and optional HTTP(S) `sourceUrl`;
- `origin=MANUAL`, recording staff user and server `recordedAt`.

The API never converts a decimal through binary floating point. A missing cost, currency, VAT, availability, lead time, source timestamp or expiration stays missing. If the source date is absent, server `recordedAt` is retained separately and is not presented as a source-provided date. A URL is stored and displayed to authorized staff only; the server does not request, crawl, embed or validate its destination by fetching it.

`modificationEvidence` is `SPECIFIED | CONFIRMED_NONE | UNKNOWN`. `SPECIFIED` requires non-empty `modification`; the other states require `modification=null`. `UNKNOWN` never equals an absent product modification. `CONFIRMED_NONE` is an explicit human assertion that the source identifies the SKU as having no modification. Its evidence/reason is retained in the restricted revision record.

### Freshness and comparison

Freshness is derived, not a mutable offer state. Explicit `expiresAt` takes precedence; the offer is stale when `expiresAt <= now`. Without it, age is evaluated against the owner-approved configured freshness window using `sourceObservedAt ?? recordedAt`. If no window is configured, freshness is `UNKNOWN`, never implicitly fresh. The precise configuration scope/window is OD-007A-02.

Staff comparison shows current, stale, and unknown-freshness offers distinctly, and can show history on request. Archived supplier/offer rows are history, not current comparison candidates. Offers in different currencies are grouped; no FX rate is invented. Sorting by price is only within a single currency and is not a recommendation or source selection.

## ProductMatchProposal and current association

`ProductMatchProposal` records one proposal against a specific offer revision and product. It stores both identity snapshots, exact-key evidence, proposal author/time, state `PENDING | APPROVED | REJECTED`, decision actor/time, required bounded decision reason, and version. Proposal decisions are immutable. A rejected proposal is terminal; retrying the same idempotent command returns its original result and cannot convert it to approved.

The catalog identity is exactly the frozen R1-004 tuple:

`(brandId, manufacturerName, originalPartNumber, modification)`

Text normalization is exactly R1-004: Unicode NFC and trim only outer U+0020 spaces; case, internal whitespace, punctuation and hyphens remain significant; compare text with PostgreSQL `COLLATE "C"`. The supplier side must explicitly select an existing active `brandId`, provide manufacturer and original part number, and provide `SPECIFIED` or `CONFIRMED_NONE` modification evidence. The resulting complete tuple must equal the current catalog product tuple. No fuzzy candidate path exists. A supplier SKU is never substituted for `originalPartNumber`.

The current association is the single nullable `SupplierOffer.currentMatchProposalId` pointer, which may point only to an `APPROVED` proposal for that same offer. It is guarded by a deferred FK/transaction guard. Prior approved proposals remain immutable history when a later approved proposal replaces the current pointer. This supports correction without rewriting an old decision or adding an unapproved proposal state. Clearing a current association is an explicit, reasoned, audited unlink command.

An approved proposal stores the exact identity snapshots it approved. Its _effective_ match is derived as `CURRENT` only while the current offer revision and current CatalogProduct identity tuples still equal those snapshots and both roots remain matchable. A changed identity yields derived `REVIEW_REQUIRED`; the proposal history remains intact and the link is not eligible for downstream costing. A human may create and approve a new exact proposal or explicitly unlink. No automatic relink occurs. Product eligibility (non-archived products versus published products only) is OD-007A-05.

Create/decision transactions serialize on SupplierOffer and CatalogProduct rows and revalidate current state and identity under lock. Decisions use expected versions, an idempotency key, CSRF/Origin protections and one audit transaction. Concurrent stale writes return `409 VERSION_CONFLICT` or `409 IDENTITY_CHANGED` without a partial link or success audit.

## Referential and privacy rules

- Supplier and offer history never cascade-delete. Supplier/offer archive is a state transition, not erasure.
- Catalog `Brand` is a restricted FK for an explicitly selected identity; its FK grants no permission to read the Brand or product.
- Offers, costs, contact details, internal notes, provenance and matching evidence are only returned by staff endpoints with the permissions in the separate matrix.
- No supplier fields are added to public catalog/quotation DTOs. No supplier cost updates catalog prices or approved quotation snapshots.
- New products are created only through the existing R1-004 DRAFT/review workflow; R1-007 does not create them as a side effect.
