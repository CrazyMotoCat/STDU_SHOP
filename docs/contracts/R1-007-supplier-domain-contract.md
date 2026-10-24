# R1-007A — Supplier Domain Contract

**Status:** PROPOSED / REVIEW_REQUIRED
**Contract version:** `0.1.0-proposed`
**Baseline:** `1e3c24cdd04628180f600f28aab0f88c37f23eb8`
**Scope:** internal supplier registry, manually recorded supplier offers, strict catalog-match proposals, one-at-a-time staff decisions, comparison and audit.

This package extends the approved R1 requirements and FROZEN R1-002, R1-004 and R1-006A without editing their artifacts. It does not authorize migrations or application code. Owner decisions below are the only proposed business-rule choices still requiring explicit approval.

## Contract artifacts

- [Data model](R1-007-supplier-data-model.md) and machine-readable [model JSON](R1-007-supplier-data-model.json).
- [Staff OpenAPI](R1-007-suppliers.openapi.json).
- [Permission matrix](R1-007-supplier-rbac-matrix.md) and [RBAC JSON](R1-007-supplier-rbac-matrix.json).
- [Protected Staff UI routes](R1-007-supplier-staff-ui.md).
- [State machine](R1-007-supplier-state-machine.md).
- [Audit registry](R1-007-supplier-audit-registry.json).
- [Acceptance matrix](R1-007-test-matrix.md).
- [Owner decisions OD-007A-01…07](../plans/R1-007A-owner-decisions.md).
- [R1-007B implementation outline](../plans/R1-007B-implementation-plan.md).

## Frozen boundaries carried forward

- A supplier is an external counterparty; `SellerLegalEntity` is our own seller. They are separate identities, fields, permissions and APIs.
- A SupplierOffer may have no catalog product. Multiple independent offers may point to one `CatalogProduct` after individual approval.
- Candidate discovery is exact-key only. Similar names, functional similarity, supplier SKU, or matching manufacturer part number alone never establish identity.
- An exact candidate remains `PENDING` until a permitted employee approves it. Approval/rejection is per proposal; no batch operation exists.
- Offers and their revisions are staff-only. Public DTOs and public price fields are unchanged.
- No supplier site crawling, external fetch, parser, scheduler, Redis worker, mass update, purchase order, stock reservation or automatic product creation is included.
- Supplier prices are exact decimal values with explicit currency when present. No currency, VAT, availability or delivery time is inferred. Cross-currency comparison is grouped by ISO currency code; price order is numeric only within each group and keyset pagination uses a deterministic full tie-break tuple. No FX conversion or automatic supplier selection.
- ACTIVE supplier tax identities are unique by jurisdiction and canonical identifier; archived identities retain history but do not reserve a new ACTIVE registration. Re-registration creates a distinct supplier record and never merges history.
- Every mutation has durable actor-scoped R1-007 idempotency with transactional response storage, conflict replay and indefinite retention. This introduces the sixth R1-007 table; import-specific R1-006 idempotency is not reused.
- Product-match proposals retain immutable rejection/approval history, permit one PENDING row per offer/revision/product, and allow a new proposal ID after rejection or unlink. The offer still has only one current-match pointer.
- Updating an offer never mutates a quotation revision. Future costing may consume only a current, valid, approved link and still requires the manager's explicit sourcing decision.

## Source traceability

| Contract area                                | Approved source                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Supplier provenance and manual review        | `03_MASTER_TZ_R1.md` SRC-01, SRC-05, SRC-06, SRC-07                       |
| Supplier, offer and proposal boundaries      | `05_DOMAIN_MODEL.md` Supplier, SupplierOffer, ProductMatchProposal        |
| Staff endpoints and permission boundary      | `06_API_CONTRACTS.md` supplier API outline; FROZEN R1-002 RBAC            |
| Private source data and protected operations | `07_SECURITY_OPERATIONS.md`; FROZEN R1-002 and R1-004 security invariants |
| Strict manual SKU identity                   | `08_TESTS_AND_ACCEPTANCE.md` E2E-05; `03_MASTER_TZ_R1.md` CAT-06          |
| Existing supplier/product decisions          | `01_DECISION_REGISTER.md` decisions 6, 22, 56–61                          |
| Planned scope                                | `09_ROADMAP_BACKLOG.md` R1-007                                            |

## Contract checks

Run `node docs/contracts/check-R1-007.mjs` and `node --test docs/contracts/check-R1-007.test.mjs`. These checks validate this proposed package only. They do not imply runtime implementation or approval.
