# R1-007A Owner Decisions — Proposed 0.1.0

**Status:** PROPOSED / REVIEW_REQUIRED
**Baseline:** `1e3c24cdd04628180f600f28aab0f88c37f23eb8`
**Decision scope:** only supplier identity, offer freshness, strict identity evidence, current-link correction, product eligibility and additive permissions. Approved decisions #1–108 and frozen R1-002/R1-004/R1-006A are not changed.

The contract package is reviewable without answering a serial interview. The owner may approve all recommendations together or return one list of `OD-007A-##` changes.

## OD-007A-01 — Supplier identity and duplicates

**Question:** What identifies duplicate Supplier records?
**Recommendation:** `legalName` is not unique. When a tax identifier is entered, store a normalized identifier and enforce a partial unique key for the declared jurisdiction; duplicate attempts return `SUPPLIER_IDENTITY_CONFLICT` and direct staff to inspect the existing record. Do not merge automatically. If no identifier exists, allow separately-created records with the same name and record no invented requisites.
**Alternative:** permit duplicate tax identifiers and rely on staff review.
**Effect:** recommendation prevents duplicate legal counterparties while preserving incomplete suppliers. It needs one deterministic tax-identifier normalization/jurisdiction rule before migration.

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

**Question:** How should an already approved match be repaired?
**Recommendation:** proposals are immutable `PENDING → APPROVED | REJECTED`. Approving a new exact proposal replaces the offer's single current-match pointer; a reasoned `unlink` clears it. Previous approved/rejected decisions remain history. If either current identity tuple later differs from the approved snapshot, expose derived `REVIEW_REQUIRED` and exclude the link from downstream costing until a human reapproves or unlinks it.
**Alternative:** block any offer/catalog identity edit until all links are manually removed.
**Effect:** recommendation preserves R1-004's existing product editing workflow and prevents stale associations from influencing costing without adding a persisted proposal state.

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

## Owner approval text

> Утверждаю пакет R1-007A Supplier Domain Contract версии 0.1.0-proposed на SHA `<точный SHA>` по OD-007A-01…06. Если утверждаются только отдельные решения или требуются изменения, укажу их ID и формулировку. Это утверждение разрешает зафиксировать пакет FROZEN 1.0.0 и начать R1-007B после интеграции контракта; оно не разрешает production migration, production deployment или реальные выдачи permissions.
