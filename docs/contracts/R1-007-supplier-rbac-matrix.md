# R1-007 Supplier Permissions — Proposed 0.1.0

All permissions are new, default-deny entries. The JSON file is the machine-readable source for this matrix. No code, existing role template, protected administrator set, or role assignment is changed by R1-007A.

| Permission                 | Allows                                                          | Additional checks                                                                                              |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `suppliers.read`           | Supplier directory, contacts, requisites and state              | Staff session; no public access                                                                                |
| `suppliers.write`          | Create, edit and archive suppliers                              | OCC and audit; never grants offer/match authority                                                              |
| `suppliers.offers.read`    | Offers, revisions, purchase costs, freshness and match history  | For offer details/comparison also require `suppliers.read`                                                     |
| `suppliers.offers.write`   | Create, append a revision to, or archive offers                 | Active supplier, OCC and audit; cannot approve a match                                                         |
| `suppliers.matches.decide` | Create proposal; individually approve/reject; explicitly unlink | Also requires `suppliers.offers.read`, `suppliers.read`, `catalog.products.read` and `catalog.references.read` |

Reading audit requires existing frozen `audit.read` plus the corresponding supplier/offer read permission. A role name or UI visibility grants nothing. The access-admin/bootstrap-admin templates receive no automatic supplier permissions; normal R1-002 RBAC remains the only grant path.

**Owner decision required:** R1-002's frozen `PermissionCode` schema is an enum. OD-007A-06 requests approval for an additive runtime/contract permission-catalog extension while keeping all FROZEN R1-002/R1-004/R1-006A artifacts unchanged. Until that extension is approved, the proposal is not implementable through normal role administration and must not be worked around with a bypass or seeded grant.
