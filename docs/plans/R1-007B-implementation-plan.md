# R1-007B — Implementation Outline for FROZEN R1-007A 1.0.0

This outline follows owner approval of R1-007A on SHA `241b9c1a6d6e57b7ff1999e1aae46b66c33cb131`. It authorizes implementation after contract integration, but no production migration/deployment or live permission grant.

1. Extend the runtime Permission registry additively; keep frozen R1-002/004/006A artifacts and protected-admin set unchanged. Do not grant permissions automatically.
2. Add Prisma/PostgreSQL supplier roots, immutable offer revisions, proposal history, current-match pointer and integrity/index constraints; migration must be additive and non-destructive.
3. Implement NestJS services, DTO validation, staff endpoints, RBAC, CSRF/Origin, OCC, durable `SupplierCommandIdempotency` per OD-007A-07, and same-transaction AuditEvent writes. Use a PostgreSQL transaction-scoped actor/scope/key lock plus the unique constraint, RFC 8785 canonical request hashing and durable replay; never reuse import-scoped R1-006 records. Lock and revalidate offer/product identity before each decision.
4. Implement strict candidate generation against the frozen CatalogProduct identity tuple, staff comparison/freshness and per-item decision workflow. No fuzzy search, scraper, auto-create, public cost or bulk action.
5. Add protected Staff UI only under supplier routes; no public page/global-site/shared-nav changes without a separate agreed UI boundary.
6. Verify PostgreSQL migrations, SUP-01…28, E2E-05, denied permissions, concurrent idempotency/proposal writes and final DB state, deterministic currency-group keyset pagination, public DTO non-disclosure, and approved quotation immutability.
7. Run independent backend, database and security reviews plus required quality gate and CI before AUTO_MERGE. Do not run production operations.
