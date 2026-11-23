BEGIN;

CREATE TABLE public.ingestion_application_edits (
 application_id uuid PRIMARY KEY REFERENCES public.ingestion_application(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 edits jsonb NOT NULL CHECK (jsonb_typeof(edits) = 'object' AND edits <> '{}'::jsonb),
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object')
);
CREATE FUNCTION public.ingestion_application_edits_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.ingestion_application a
   WHERE a.id=NEW.application_id AND a.operation='UPDATE'
     AND a.xmin=pg_current_xact_id()::xid
 ) THEN RAISE EXCEPTION 'Explicit edits require a new UPDATE application in the same transaction'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_application_edits_integrity BEFORE INSERT ON public.ingestion_application_edits
 FOR EACH ROW EXECUTE FUNCTION public.ingestion_application_edits_integrity();
CREATE TRIGGER ingestion_application_edits_immutable BEFORE UPDATE OR DELETE ON public.ingestion_application_edits
 FOR EACH ROW EXECUTE FUNCTION public.ingestion_immutable();
GRANT SELECT, INSERT ON public.ingestion_application_edits TO stdu_runtime;

ALTER TABLE public.permission DROP CONSTRAINT permission_code_check;
ALTER TABLE public.permission ADD CONSTRAINT permission_code_check CHECK (
 code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' OR code IN ('ingestion.createOffer', 'ingestion.applyEdits')
);
INSERT INTO public.permission(id,code,description) VALUES
 ('a009b002-0000-4000-8000-000000000001','ingestion.applyEdits',
  'Apply explicit economic edits from one accepted staging row');

DO $apply_edits_audit$
DECLARE definition text;
DECLARE extended text;
BEGIN
 SELECT pg_get_functiondef('public.audit_event_valid_r1_002(text,text,text,jsonb)'::regprocedure) INTO definition;
 extended := replace(definition, $old$'ingestion.createOffer'$old$,
   $new$'ingestion.createOffer','ingestion.applyEdits'$new$);
 IF extended = definition THEN RAISE EXCEPTION 'Explicit edits audit permission anchor missing'; END IF;
 EXECUTE extended;
END;
$apply_edits_audit$;
COMMIT;
