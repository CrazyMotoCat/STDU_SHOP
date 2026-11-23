# R1-009B NEXT C — reconciled CREATE

Depends on NEXT B, including the append-only evidence and approval schema introduced there. This draft adds no separate migration. The independent flag `SUPPLIER_INGESTION_RECONCILE_CREATE_ENABLED` defaults off. A confirmed submission cannot create an offer until an employee with both reconciliation execution and supplier offer creation rights explicitly runs CREATE.

The original manufacturer and part number must match the verified artifact exactly. The artifact can complete missing brand or modification, including verified CONFIRMED_NONE, without rewriting staging. The current source, independent approval and supplier-scoped duplicate set are rechecked before one transaction writes revision one, supplier and reconciliation audit, application provenance and receipt. Active exact and unresolved ambiguous candidates block CREATE. Archived matches are visible and require acknowledgement during approval and execution. Legacy CREATE-01 remains independently gated.

Rollback turns off the new command family and retains the expanded database, all evidence, offer history and receipts. Production activation, persistent PostgreSQL migrations and deployment are excluded.
