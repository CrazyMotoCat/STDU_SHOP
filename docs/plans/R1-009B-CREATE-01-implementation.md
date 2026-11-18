# R1-009B CREATE-01 implementation plan

**DRAFT / REVIEW_REQUIRED.** CD-01–05 approved for the design. This file contains proposed SQL for a future implementation PR and a disposable PostgreSQL test plan.

## Scope and sequence

1. Expand the existing ledger, regenerate Prisma and use explicit legacy serializers. Existing inserts default to UPDATE. Prisma maps operation to a string with default UPDATE and base relation to nullable. Add composite FK mappings using the existing revision pair. Verify migration ordering and restored grants.
2. Add the dedicated default-deny permission to the application registry and additive audit validator policy. Keep existing grant ceilings and role links. Do not add the permission to existing roles or widen the FROZEN management API. Until a separate authorized grant process exists, exercise the permission only in isolated fixtures.
3. Implement the two Staff CREATE routes specified in the API plan and a bounded read inspection before ACCEPT. Build an internal projection for CREATE provenance. Deploy with creation disabled until schema and compatibility checks pass.
4. Reuse the R1-007 input validator and root/revision/audit logic through a transaction-aware helper. The existing R1-007 endpoint retains its receipt store and behavior. CLEAR, reconciliation and incomplete identities are deferred.

## Exact identity and duplicate rules

CREATE-01 requires a complete tuple already established with exact evidence, including an active brand ID. If the staged format lacks a verified brand ID, show the exact staged brand text and require explicit selection of an active brand supported by existing verified evidence. If no such mapping can be established from trusted evidence, block this slice. Do not infer brand from approximate labels or introduce a new reconciliation workflow. Require nonempty manufacturer and original part number and SPECIFIED modification from supported staging. UNKNOWN is ineligible. Show all confirmed tuple values before execution. The CREATE preview and execution DTOs extend the proposal with brandId and an explicit identityConfirmed:true at execution, bound to the preview tuple and accepted decision. Preview and execute use the same normalized identity.

Under the supplier row lock, inspect current revisions with exact supplier-scoped normalized tuple matching. Active exact matches block. Active overlap with incomplete or contradictory identity requires review. Archived exact matches require acknowledgement of the sorted ID/version set. A changed set invalidates the preview. Apply the comparison against all relevant records, with bounded output that fails closed on overflow. Legacy writes can still create duplicates later. The guarantee concerns concurrent staging CREATE commands.

## Atomic command and replay

Check session, Origin, CSRF and request DTO. Start one READ COMMITTED transaction. Take the existing actor/key advisory lock and check current permissions before receipt lookup. Identical receipt replay can use a fresh authorized session and returns the saved status/body before preview expiry checks. Different fingerprint yields IDEMPOTENCY_KEY_REUSED. For a new command verify the token, lock source then supplier then staging row, compare row/version/hash, decision, source version and supplier state, and recheck eligibility and duplicates after acquiring the supplier lock. Recheck active brand under its existing lock before writing. Neither ACCEPT nor preview reserves the staging row.

Insert offer root with currentRevisionId pointing to its generated revision using the existing deferred FK, insert immutable MANUAL revision 1, write supplier_offer.created audit, append CREATE application and store 201 response receipt in that transaction. Use existing ingestion conflict/denial audit where applicable. Record actor and references only. No external or catalog/public writes. SQL/audit failures roll back all writes. Persist terminal 409 receipts only before business writes, or use a savepoint that rolls them back first. Do not catch PostgreSQL unique violations inside an aborted transaction. If a unique violation occurs despite serialization, roll back and inspect committed state in a fresh authorized transaction before classifying it.

## Proposed PostgreSQL migration SQL

Run in one migration transaction. Inspect catalog constraints first, including the automatically named version check and the existing unique (id, offer_id) target. The migration must fail if expected constraints are missing. Composite FK validation checks populated data in the same transaction. Use no data UPDATE, since the existing immutable trigger protects history. Keep existing keys, trigger and grants.

```sql
BEGIN;
ALTER TABLE public.ingestion_application
 ADD COLUMN operation text NOT NULL DEFAULT 'UPDATE',
 ALTER COLUMN base_revision_id DROP NOT NULL,
 DROP CONSTRAINT ingestion_application_version_check,
 DROP CONSTRAINT ingestion_application_revisions_differ,
 ADD CONSTRAINT ingestion_application_operation_check CHECK (
   (operation='CREATE' AND base_revision_id IS NULL AND version=1)
   OR (operation='UPDATE' AND base_revision_id IS NOT NULL
       AND base_revision_id<>revision_id AND version>1)
 ),
 ADD CONSTRAINT ingestion_application_base_offer_fk
   FOREIGN KEY (base_revision_id,offer_id)
   REFERENCES public.supplier_offer_revision(id,offer_id)
   MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT,
 ADD CONSTRAINT ingestion_application_result_offer_fk
   FOREIGN KEY (revision_id,offer_id)
   REFERENCES public.supplier_offer_revision(id,offer_id)
   ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE OR REPLACE FUNCTION public.ingestion_application_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.ingestion_row r
  JOIN public.ingestion_run run ON run.id=r.run_id
  JOIN public.ingestion_source source ON source.id=run.source_id
  JOIN public.ingestion_decision decision ON decision.row_id=r.id
  JOIN public.supplier_offer offer ON offer.id=NEW.offer_id AND offer.supplier_id=source.supplier_id
  JOIN public.supplier supplier ON supplier.id=offer.supplier_id
  LEFT JOIN public.supplier_offer_revision base ON base.id=NEW.base_revision_id AND base.offer_id=offer.id
  JOIN public.supplier_offer_revision revision ON revision.id=NEW.revision_id AND revision.offer_id=offer.id
  WHERE r.id=NEW.row_id AND run.id=NEW.run_id AND source.id=NEW.source_id
   AND decision.id=NEW.decision_id AND decision.decision='ACCEPT' AND r.review_state='ACCEPTED'
   AND r.error_code IS NULL AND r.normalized IS NOT NULL
   AND r.source_hash=NEW.source_hash AND run.source_hash=NEW.source_hash
   AND run.state IN ('COMPLETE','PARTIAL') AND source.state='ENABLED' AND run.source_version=source.version
   AND supplier.state='ACTIVE' AND offer.state='ACTIVE'
   AND offer.current_revision_id=revision.id AND offer.version=NEW.version
   AND revision.recorded_by_staff_user_id=NEW.actor_id
   AND (
    (NEW.operation='UPDATE' AND revision.revision_no=base.revision_no+1)
    OR
    (NEW.operation='CREATE' AND revision.revision_no=1
     AND revision.origin='MANUAL' AND offer.current_match_proposal_id IS NULL
     AND offer.created_by_staff_user_id=NEW.actor_id
     AND offer.updated_by_staff_user_id=NEW.actor_id)
   )
 ) THEN RAISE EXCEPTION 'Ingestion application provenance mismatch'; END IF;
 RETURN NEW;
END; $$;

INSERT INTO public.permission(id,code,description) VALUES
 ('a009b001-0000-4000-8000-000000000001','ingestion.createOffer',
  'Create one supplier offer from accepted staging');
COMMIT;
```

The pre-existing permission audit validator must learn this code in an additive migration before any role assignment is considered. CREATE-01 ships no grant operation. Test direct PostgreSQL behavior under the runtime role and use the existing supplier audit event for the successful CREATE.

## Rollback

Disable CREATE and drain active commands first. After any CREATE receipt/application exists, roll back application code while retaining the expanded schema and provenance. Verify legacy serializers and new-write disablement on that rollback deployment, including ALREADY_APPLIED for CREATE rows. A down migration is allowed only before any CREATE commit, after confirming no grant/history refers to the new permission, and after restoring a compatible application. Below is the ledger portion. Restore the exact original function from migration 20261108090000 using CREATE OR REPLACE in the same transaction. Keep registered permissions that have been referenced historically.

```sql
BEGIN;
LOCK TABLE public.ingestion_application IN ACCESS EXCLUSIVE MODE;
DO $rollback$
BEGIN
 IF EXISTS (SELECT 1 FROM public.ingestion_application WHERE operation='CREATE') THEN
  RAISE EXCEPTION 'CREATE history exists: retain expanded schema';
 END IF;
END
$rollback$;
ALTER TABLE public.ingestion_application
 DROP CONSTRAINT ingestion_application_base_offer_fk,
 DROP CONSTRAINT ingestion_application_result_offer_fk,
 DROP CONSTRAINT ingestion_application_operation_check,
 ALTER COLUMN base_revision_id SET NOT NULL,
 DROP COLUMN operation,
 ADD CONSTRAINT ingestion_application_version_check CHECK (version>1),
 ADD CONSTRAINT ingestion_application_revisions_differ CHECK (base_revision_id<>revision_id);

CREATE OR REPLACE FUNCTION public.ingestion_application_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM public.ingestion_row r
  JOIN public.ingestion_run run ON run.id=r.run_id
  JOIN public.ingestion_source source ON source.id=run.source_id
  JOIN public.ingestion_decision decision ON decision.row_id=r.id
  JOIN public.supplier_offer offer ON offer.id=NEW.offer_id AND offer.supplier_id=source.supplier_id
  JOIN public.supplier supplier ON supplier.id=offer.supplier_id
  JOIN public.supplier_offer_revision base ON base.id=NEW.base_revision_id AND base.offer_id=offer.id
  JOIN public.supplier_offer_revision revision ON revision.id=NEW.revision_id AND revision.offer_id=offer.id
  WHERE r.id=NEW.row_id AND run.id=NEW.run_id AND source.id=NEW.source_id
   AND decision.id=NEW.decision_id AND decision.decision='ACCEPT' AND r.review_state='ACCEPTED'
   AND r.error_code IS NULL AND r.normalized IS NOT NULL
   AND r.source_hash=NEW.source_hash AND run.source_hash=NEW.source_hash
   AND run.state IN ('COMPLETE','PARTIAL') AND source.state='ENABLED' AND run.source_version=source.version
   AND supplier.state='ACTIVE' AND offer.state='ACTIVE'
   AND offer.current_revision_id=revision.id AND offer.version=NEW.version
   AND revision.recorded_by_staff_user_id=NEW.actor_id
   AND revision.revision_no=base.revision_no+1
 ) THEN RAISE EXCEPTION 'R1-009A application provenance mismatch'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
```

## Disposable PostgreSQL acceptance tests

| Fixture or fault                                                            | Required result                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Populated R1-009A database with applications, receipts, roles and decisions | Apply migration, compare legacy projections and all historical values and grants, run old UPDATE and replay, verify pg_dump/restore and strict composite FKs.                                                                     |
| Invalid CREATE and UPDATE SQL inserts                                       | Reject wrong base shape, version, revision/offer pair, actor, source, row or decision. Reject UPDATE/DELETE of provenance.                                                                                                        |
| Rollback pre-CREATE and after CREATE                                        | Pre-CREATE down restores old constraints with history intact. Down after CREATE aborts. Compatibility-build rollback retains CREATE history and rejects repeat APPLY.                                                             |
| Two keys on same row and simultaneous CREATE/UPDATE                         | Use two transactions with barrier before row lock. Exactly one application, one business revision and a deterministic loser, with denied/failed audit semantics.                                                                  |
| Two accepted rows with same exact key                                       | Use separate sessions and barrier before supplier lock. Winner commits, loser rechecks duplicates and performs zero business writes. Test existing legacy writer commits first and ensure CREATE sees it.                         |
| Archived vs active vs ambiguous duplicate                                   | Active and ambiguous block. Archived warning requires exact ID/version acknowledgement; a concurrent archival/revision change invalidates old preview.                                                                            |
| Lost COMMIT response                                                        | Drop acknowledgement after actual commit, reconnect under same actor with expired token, verify exact original 201/IDs; count one offer, revision, audit, application and receipt. Different payload or revoked permission fails. |
| Audit failure and stale dependency                                          | Force audit insert failure after offer data preparation; all writes roll back. Concurrent source disable, supplier archive, row version, brand archive, duplicate set change or foreign supplier must block.                      |
| R1-009A and public routes                                                   | Run REV-01–12 and shared ingestion regression. Compare legacy DTOs, consumed state, catalog/match rows and public price projection before/after.                                                                                  |
| Authorization and Staff UI                                                  | Role defaults, missing/dropped permission, Origin/CSRF, explicit confirmation, empty/error states, replay and manual conflict refresh.                                                                                            |

Run the tests on a uniquely owned disposable database using the repository's approved harness. No CREATE-01 runtime behavior has been implemented or verified at this stage.
