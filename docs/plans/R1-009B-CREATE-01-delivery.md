# R1-009B CREATE-01

**REVIEW_REQUIRED.** Implements the owner-approved CREATE slice from contract PR #61. The implementation PR is based on main independently of the documentation branch.

CREATE uses existing permission checks plus default-deny `ingestion.createOffer`, staff-bound CSRF, accepted staging and explicit confirmation. An exact active brand name must identify a single active brand and be selected by staff. Current fixture adapters provide SPECIFIED modification only. UNKNOWN or ambiguous identity cannot execute and requires future reconciliation. No conversion to CONFIRMED_NONE is inferred.

Supplier locking serializes staged CREATE and checks exact active duplicates and ambiguous overlaps. The acknowledgement set covers archived exact matches and is bound to the preview together with the captured identity and versions. Existing standalone R1-007 rules still apply to its own writers. CREATE stores revision 1, domain audit, shared ledger and committed receipt in one transaction.

Rollback after a successful CREATE uses this compatibility build (the implementation PR HEAD or a verified descendant with the ledger projections) restarted with `SUPPLIER_INGESTION_CREATE_ENABLED=false`. The default is disabled. Keep the expanded schema and historical rows. Do not deploy a pre-expansion Prisma client against a database containing CREATE history because that client requires a non-null base revision. Legacy preview returns ALREADY_APPLIED with a null legacy application, legacy applications omits CREATE entries, and legacy APPLY denies a consumed row. The new provenance read still shows CREATE history.

Verification commands are `pnpm test:r1-009b:create` (includes populated upgrade, repeated migrate deploy, pg_dump/restore, guarded reverse DDL and browser checks), `pnpm test:r1-009a`, `pnpm test:r1-008b`, `pnpm test:r1-007b` and the repository contract and CI gates. The explicit test environment enables CREATE and assigns its permission to synthetic test actors only.
