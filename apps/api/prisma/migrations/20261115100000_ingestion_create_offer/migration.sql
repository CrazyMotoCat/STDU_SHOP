BEGIN;
ALTER TABLE public.ingestion_application
 ADD COLUMN operation text NOT NULL DEFAULT 'UPDATE',
 ALTER COLUMN base_revision_id DROP NOT NULL,
 DROP CONSTRAINT ingestion_application_version_check,
 DROP CONSTRAINT ingestion_application_revisions_differ,
 DROP CONSTRAINT ingestion_application_base_revision_id_fkey,
 DROP CONSTRAINT ingestion_application_revision_id_fkey,
 ADD CONSTRAINT ingestion_application_operation_check CHECK (
   (operation='CREATE' AND base_revision_id IS NULL AND version=1)
   OR (operation='UPDATE' AND base_revision_id IS NOT NULL
       AND base_revision_id<>revision_id AND version>1)
 ),
 ADD CONSTRAINT ingestion_application_base_offer_fk
   FOREIGN KEY (base_revision_id,offer_id)
   REFERENCES public.supplier_offer_revision(id,offer_id)
   ON DELETE RESTRICT ON UPDATE RESTRICT,
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
 ) THEN RAISE EXCEPTION 'R1-009A application provenance mismatch'; END IF;
 RETURN NEW;
END; $$;

-- Preserve the existing permission syntax and admit only the approved exact code.
ALTER TABLE public.permission DROP CONSTRAINT permission_code_check;
ALTER TABLE public.permission ADD CONSTRAINT permission_code_check CHECK (
 code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' OR code='ingestion.createOffer'
);

INSERT INTO public.permission(id,code,description) VALUES
 ('a009b001-0000-4000-8000-000000000001','ingestion.createOffer',
  'Create one supplier offer from accepted staging');

-- Extend only the existing role-event validator, not grant eligibility.
DO $create_offer_audit$
DECLARE definition text;
DECLARE extended text;
BEGIN
 SELECT pg_get_functiondef('public.audit_event_valid_r1_002(text,text,text,jsonb)'::regprocedure) INTO definition;
 extended := replace(definition, $old$'ingestion.run','ingestion.review'
  ];$old$, $new$'ingestion.run','ingestion.review','ingestion.createOffer'
  ];$new$);
 IF extended = definition THEN RAISE EXCEPTION 'CREATE-01 audit permission extension anchor missing'; END IF;
 EXECUTE extended;
END;
$create_offer_audit$;
COMMIT;
