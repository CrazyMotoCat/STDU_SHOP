# R1-007A Owner Decisions — Proposed 0.1.0

**Status:** PROPOSED / REVIEW_REQUIRED
**Baseline:** `1e3c24cdd04628180f600f28aab0f88c37f23eb8`
**Decision scope:** only supplier identity, offer freshness, strict identity evidence, current-link correction, product eligibility, additive permissions, and supplier-command idempotency required by R1-007. Approved decisions #1–108 and frozen R1-002/R1-004/R1-006A are not changed.

The contract package is reviewable without answering a serial interview. The owner may approve all recommendations together or return one list of `OD-007A-##` changes.

## OD-007A-01 — Supplier identity and duplicates

**Question:** What identifies duplicate Supplier records, including after archive?
**Recommendation:** `legalName` is not unique. `taxIdentifier` and `taxJurisdiction` are either both null or both present. Jurisdiction is an uppercase ISO-3166-1 alpha-2 code. For `RU`, accept exactly 10 or 12 ASCII decimal digits as a string, preserve leading zeroes, and validate the applicable Russian INN control digit(s); do not trim or rewrite the identifier. For other jurisdictions, normalize to Unicode NFC and remove only outer ASCII U+0020 spaces, preserve case/internal characters/leading zeroes, and do not apply Russian length, digit or checksum rules. Store this canonical value. Enforce uniqueness of `(taxJurisdiction, canonical taxIdentifier)` only among `ACTIVE` suppliers with a partial unique index; archived rows retain their complete history but do not reserve the identity. Re-registering a pair that exists only on archived rows creates a new ACTIVE Supplier with a new ID and independent history. If an ACTIVE row already has the pair, return `SUPPLIER_IDENTITY_CONFLICT`. Never unarchive, merge, or transfer history automatically. If no identifier is provided, allow separate records with the same name and do not fabricate requisites.
**Alternative:** keep identifiers unique across ACTIVE and ARCHIVED history, which requires an explicit owner-controlled reactivation/transfer process before a legal counterparty can be re-registered.
**Effect:** the recommendation preserves archived evidence and permits an intentional new registration without conflating histories. The database partial unique index is the final race-safe authority.

## OD-007A-02 — Offer freshness

**Question:** Which freshness policy applies when an offer has no explicit expiry?
**Recommendation:** `expiresAt` is authoritative. Otherwise evaluate `sourceObservedAt ?? recordedAt` against one configurable organization-level `supplierOfferFreshnessDays` value. No hard-coded duration is introduced; until configured, label freshness `UNKNOWN` and never imply validity. Stale values remain visible in history, separately labelled, and are excluded from current comparisons.
**Alternative:** require explicit expiry on every offer; offers without one are always `UNKNOWN`.
**Effect:** a configuration value is needed to use unexpired offers without source expiry. No automatic fetch, source schedule, or public-price update is added.

## OD-007A-03 — Exact identity and absent modification

**Question:** What evidence is enough for a proposal to be approved?
**Recommendation:** require exact equality with the frozen R1-004 tuple `(brandId, manufacturerName, originalPartNumber, modification)` and its normalization. The supplier's brand must be explicitly mapped to an existing ACTIVE Brand. `modificationEvidence=UNKNOWN` never matches a null catalog modification; a human may mark `CONFIRMED_NONE` only after verifying the source. Only complete exact candidates are created; incomplete offers stay unmatched for staff enrichment/review. Text similarity and supplier SKU never count.
**Alternative:** permit a person to approve incomplete/non-equal tuples with a bounded manual evidence note.
**Effect:** recommendation is strongest against false SKU links; human review can enrich source identity but cannot override a mismatching SKU key.

## OD-007A-04 — Correcting a match and identifier changes

**Question:** How should a previously rejected proposal or an unlinked association be reconsidered?
**Recommendation:** each proposal is immutable after its one decision (`PENDING → APPROVED | REJECTED`); rejected proposals and approved proposals remain historical records, including after an explicit reasoned unlink. Permit at most one `PENDING` proposal for a given `(offerId, offerRevisionId, proposedProductId)` using a partial unique index, while permitting a new proposal with a new ID after rejection or unlink. Every new proposal has its own audit event. The same Idempotency-Key replays the original recorded outcome and never creates a second proposal. A new key is required for a genuinely new attempt. Approving a new exact proposal replaces the offer's one current-match pointer; unlink clears it and never restores an earlier pointer. If either current identity tuple later differs from the approved snapshot, expose derived `REVIEW_REQUIRED` and exclude the link from downstream costing until a human creates and approves a new exact proposal or unlinks it.
**Alternative:** block any offer/catalog identity edit until all links are manually removed.
**Effect:** recommendation preserves R1-004's existing product editing workflow, permits explicit re-review without rewriting decisions, prevents duplicate active proposals and stale links from influencing costing, and adds no proposal state.

## OD-007A-05 — Matchable catalog product states

**Question:** Which CatalogProduct roots may be match candidates?
**Recommendation:** any non-archived product root with a complete identity tuple, including DRAFT and review states visible to a permitted staff editor. A candidate is an internal association only; it does not publish the product. Its identity is revalidated on approval and every downstream use.
**Alternative:** only products with a currently published revision may be candidates.
**Effect:** recommendation supports sourcing work before publication while keeping publication separately gated. If the alternative is selected, new/unpublished items stay unmatched until publication.

## OD-007A-06 — Permission extension

**Question:** May R1-007 add these five permissions to the operational permission catalog while leaving FROZEN R1-002/R1-004/R1-006A files and existing grants unchanged?

`suppliers.read`, `suppliers.write`, `suppliers.offers.read`, `suppliers.offers.write`, `suppliers.matches.decide`.

**Recommendation:** approve this additive extension. Keep all permissions default-deny, do not alter the protected R1-002 full-admin set or any role template/assignment, and continue to grant only through the ordinary R1-002 RBAC API under its existing grant ceiling. The composed runtime permission schema may expose the additive codes, but prior frozen artifacts remain byte-identical.
**Alternative:** keep the frozen permission enum unchanged.
**Effect:** the alternative blocks normal staff role delegation and therefore blocks R1-007B. No CLI/bootstrap bypass is proposed.

## OD-007A-07 — Durable supplier-command idempotency

**Question:** What durable result store guarantees replay after concurrent requests and API restart for every R1-007 mutation?
**Recommendation:** add the sixth R1-007 table, `SupplierCommandIdempotency`, because the existing R1-006 upload/row-decision records are domain-scoped and cannot provide a shared key scope, response replay, or Supplier OCC-conflict replay. Preserve the OpenAPI header contract: an opaque `Idempotency-Key` string of 8–128 characters, scoped by `(authenticated actorStaffUserId, fixed scope 'R1-007', exact key)` across all mutation routes. Compute SHA-256 over RFC 8785 canonical JSON containing API version, operationId, HTTP method, normalized path/query values, actor ID and validated canonical request DTO (including expected versions); store the 32-byte digest. Serialize a key with a PostgreSQL transaction-scoped advisory lock derived from the exact actor/scope/key tuple, then in the same PostgreSQL transaction perform the domain operation, write successful AuditEvent when there is a successful mutation, and persist exact HTTP status plus response body. The database unique constraint remains the durable backstop. Identical concurrent or post-restart retries return the stored result; a different hash under the same scoped key returns `409 IDEMPOTENCY_KEY_REUSED` without a new mutation. Persist deterministic terminal OCC/domain `409` results such as `VERSION_CONFLICT` with no domain mutation or success audit; retrying the same key replays that same conflict. A client correcting its expected version or payload must send a new key. Authentication, CSRF, Origin, validation and current permission checks occur before a saved response can be replayed. Store only the existing sanitized mutation receipt/proposal response, never request bodies, supplier private fields, source URLs or purchase costs. Keep records append-only and retain them indefinitely in R1; no expiry cleanup is allowed.
**Alternative:** retain idempotency only in process memory or reuse import-specific tables. These options cannot safely replay Supplier mutations after restart or provide a single consistent scope across routes.
**Effect:** this adds one explicit domain-support table (six total R1-007 tables), not a new service or permission bypass. Indefinite retention provides unbounded retry protection but requires disk-growth monitoring; any future purge policy needs an owner-approved contract update and a minimum retention guarantee.

## Owner approval text

> Утверждаю пакет R1-007A Supplier Domain Contract версии 0.1.0-proposed на SHA `<точный SHA>` по OD-007A-01…07. Если утверждаются только отдельные решения или требуются изменения, укажу их ID и формулировку. Это утверждение разрешает зафиксировать пакет FROZEN 1.0.0 и начать R1-007B после интеграции контракта; оно не разрешает production migration, production deployment или реальные выдачи permissions.
