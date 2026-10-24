# R1-007B — Implementation Outline (after owner approval)

This outline is conditional on owner approval of R1-007A and integration of the FROZEN contract. It authorizes no production migration/deployment by itself.

1. Extend the runtime Permission registry additively; keep frozen R1-002/004/006A artifacts and protected-admin set unchanged. Do not grant permissions automatically.
2. Add Prisma/PostgreSQL supplier roots, immutable offer revisions, proposal history, current-match pointer and integrity/index constraints; migration must be additive and non-destructive.
3. Implement NestJS services, DTO validation, staff endpoints, RBAC, CSRF/Origin, OCC, idempotency and same-transaction AuditEvent writes. Lock and revalidate offer/product identity before each decision.
4. Implement strict candidate generation against the frozen CatalogProduct identity tuple, staff comparison/freshness and per-item decision workflow. No fuzzy search, scraper, auto-create, public cost or bulk action.
5. Add protected Staff UI only under supplier routes; no public page/global-site/shared-nav changes without a separate agreed UI boundary.
6. Verify PostgreSQL migrations, SUP-01…18, E2E-05, denied permissions, concurrency/final DB state, public DTO non-disclosure, and approved quotation immutability.
7. Run independent backend, database and security reviews plus required quality gate and CI before AUTO_MERGE. Do not run production operations.
