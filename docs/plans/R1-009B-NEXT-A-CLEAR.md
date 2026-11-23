# R1-009B NEXT A — explicit supplier edits

Scope SRC-03–07. This draft implements individual edits for an exact, accepted staging row and a current active supplier offer. Legacy R1-009A APPLY and CREATE-01 retain their existing commands and contracts. NEXT B will target this branch for UPDATE identity reconciliation. NEXT C will target B for CREATE identity reconciliation. Owner merge authorization remains separate.

## Runtime

- `SUPPLIER_INGESTION_CLEAR_ENABLED=true` enables new inspection/preview/execution on the API and exposes the corresponding workspace in Web. It defaults off. History stays readable to staff with current read permissions.
- `ingestion.applyEdits` is default-deny and is never granted automatically. Execution also requires the existing ingestion and supplier review/read/write rights and Staff-bound CSRF.
- Set values must match the captured validated staging fact. Every cleared field has its own reason. An explicit dated withdrawal (both money facts explicitly null in the immutable source snapshot) and checksum acknowledgement are required for a paired money CLEAR.
- The private edit preview uses 30 days for price and delivery and 7 days for availability. Approved shorter limits can be installed through `SUPPLIER_INGESTION_EDIT_FRESHNESS_DAYS`, a JSON object keyed by supplier or source UUID with integer `purchaseCost`, `availabilityText` and `leadTimeText` limits. The shortest applicable limit wins. Existing global supplier offer price-age configuration and explicit expiry are respected. No renewal is inferred from ingest completion. No public pricing changes.
- Individual edits reuse the existing offer revision, ledger uniqueness, domain audit and actor-scoped command receipts. The additive `ingestion_application_edits` table stores the exact requested operations and evidence coordinates. The integrity trigger requires the same transaction as the UPDATE application. Retain all records across an application rollback. Roll back by disabling new writes and deploying a build verified against the retained expanded schema. Do not reverse the migration or remove provenance. The retention floor is the active offer lifetime plus five years after archiving, subject to longer applicable requirements; this slice adds no deletion mechanism.

## Verification

Run `pnpm test:r1-009b:create` using an isolated disposable PostgreSQL/Redis project. It exercises migration proofs, legacy CREATE, explicit text and money CLEAR, missing permissions and CSRF, stale evidence, wrong currency, audit rollback and committed-response replay through a restart. The Staff acceptance uses real browser and API, with 1440 px and 375 px previews. Also run `pnpm contract:check`, `pnpm ingestion:contract:check`, frontend and API typecheck, and the required FAST/FULL CI on the merge candidate. Evidence is scoped to the final reviewed SHA.
