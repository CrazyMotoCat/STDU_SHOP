BEGIN;

-- Only the trusted evidence-import operator may register or revoke evidence.
-- Staff HTTP commands run as stdu_runtime and can only read these records.
CREATE TABLE public.ingestion_identity_evidence (
 id uuid PRIMARY KEY,
 source_id uuid NOT NULL,
 source_version integer NOT NULL,
 kind text NOT NULL CHECK (kind IN ('MANUFACTURER_DOCUMENT','SUPPLIER_DOCUMENT','SUPPLIER_API')),
 reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 512),
 artifact_version text NOT NULL CHECK (length(btrim(artifact_version)) BETWEEN 1 AND 128),
 artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[a-f0-9]{64}$'),
 attested_at timestamptz NOT NULL,
 brand_id uuid NOT NULL REFERENCES public.brand(id),
 manufacturer_name text COLLATE "C" NOT NULL CHECK (length(btrim(manufacturer_name)) BETWEEN 1 AND 200),
 part_number text COLLATE "C" NOT NULL CHECK (length(btrim(part_number)) BETWEEN 1 AND 200),
 modification_evidence text NOT NULL CHECK (modification_evidence IN ('SPECIFIED','CONFIRMED_NONE')),
 modification text COLLATE "C" CHECK (length(btrim(modification)) BETWEEN 1 AND 120),
 CHECK ((modification_evidence='SPECIFIED')=(modification IS NOT NULL)),
 FOREIGN KEY (source_id,source_version) REFERENCES public.ingestion_source_revision(source_id,version),
 UNIQUE (id,source_id,source_version)
);
CREATE TABLE public.ingestion_identity_evidence_revocation (
 evidence_id uuid PRIMARY KEY REFERENCES public.ingestion_identity_evidence(id),
 revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reference text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 512)
);
CREATE FUNCTION public.lock_identity_evidence_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.evidence_id::text, 9009));
  RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_identity_revocation_lock
 BEFORE INSERT ON public.ingestion_identity_evidence_revocation
 FOR EACH ROW EXECUTE FUNCTION public.lock_identity_evidence_revocation();

CREATE TABLE public.ingestion_identity_submission (
 id uuid PRIMARY KEY,
 digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
 row_id varchar(64) NOT NULL REFERENCES public.ingestion_row(id),
 operation text NOT NULL CHECK (operation IN ('UPDATE','CREATE')),
 source_id uuid NOT NULL,
 source_version integer NOT NULL,
 evidence_id uuid NOT NULL,
 decision_id uuid NOT NULL REFERENCES public.ingestion_decision(id),
 requester_id uuid NOT NULL REFERENCES public.staff_user(id),
 supplier_id uuid NOT NULL REFERENCES public.supplier(id),
 offer_id uuid REFERENCES public.supplier_offer(id),
 target_revision_id uuid,
 row_version integer NOT NULL CHECK (row_version>0),
 offer_version integer CHECK (offer_version>0),
 source_hash varchar(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
 duplicate_digest text NOT NULL CHECK (duplicate_digest ~ '^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (
   (operation='UPDATE' AND offer_id IS NOT NULL AND target_revision_id IS NOT NULL AND offer_version IS NOT NULL)
   OR (operation='CREATE' AND offer_id IS NULL AND target_revision_id IS NULL AND offer_version IS NULL)
 ),
 FOREIGN KEY (target_revision_id,offer_id) REFERENCES public.supplier_offer_revision(id,offer_id),
 FOREIGN KEY (evidence_id,source_id,source_version) REFERENCES public.ingestion_identity_evidence(id,source_id,source_version),
 UNIQUE (id,digest,row_id,operation,requester_id)
);
CREATE INDEX ingestion_identity_submission_row_idx ON public.ingestion_identity_submission(row_id,created_at DESC,id DESC);
CREATE TABLE public.ingestion_identity_confirmation (
 submission_id uuid PRIMARY KEY,
 digest text NOT NULL,
 row_id varchar(64) NOT NULL,
 operation text NOT NULL,
 requester_id uuid NOT NULL,
 approver_id uuid NOT NULL REFERENCES public.staff_user(id),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (approver_id <> requester_id),
 FOREIGN KEY (submission_id,digest,row_id,operation,requester_id)
   REFERENCES public.ingestion_identity_submission(id,digest,row_id,operation,requester_id),
 UNIQUE (submission_id,row_id,operation,approver_id)
);

ALTER TABLE public.ingestion_application ADD UNIQUE (id,row_id,operation,actor_id);
CREATE TABLE public.ingestion_identity_execution (
 application_id uuid PRIMARY KEY,
 submission_id uuid NOT NULL UNIQUE,
 row_id varchar(64) NOT NULL,
 operation text NOT NULL,
 executor_id uuid NOT NULL,
 approver_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (executor_id <> approver_id),
 FOREIGN KEY (application_id,row_id,operation,executor_id)
   REFERENCES public.ingestion_application(id,row_id,operation,actor_id),
 FOREIGN KEY (submission_id,row_id,operation,approver_id)
   REFERENCES public.ingestion_identity_confirmation(submission_id,row_id,operation,approver_id)
);

CREATE FUNCTION public.ingestion_identity_submission_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.ingestion_row r
   JOIN public.ingestion_run run ON run.id=r.run_id
   JOIN public.ingestion_source source ON source.id=run.source_id
   JOIN public.ingestion_decision decision ON decision.row_id=r.id
   LEFT JOIN public.supplier_offer target ON target.id=NEW.offer_id
   WHERE r.id=NEW.row_id AND r.version=NEW.row_version AND r.review_state='ACCEPTED'
     AND r.source_hash=NEW.source_hash AND run.source_hash=NEW.source_hash
     AND source.id=NEW.source_id AND source.version=NEW.source_version AND run.source_version=NEW.source_version
     AND source.supplier_id=NEW.supplier_id AND decision.id=NEW.decision_id AND decision.decision='ACCEPT'
     AND (NEW.operation='CREATE' OR (target.supplier_id=NEW.supplier_id
       AND target.version=NEW.offer_version AND target.current_revision_id=NEW.target_revision_id))
 ) THEN RAISE EXCEPTION 'Immutable identity submission has inconsistent source or target'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_identity_submission_integrity
 BEFORE INSERT ON public.ingestion_identity_submission
 FOR EACH ROW EXECUTE FUNCTION public.ingestion_identity_submission_integrity();

CREATE FUNCTION public.ingestion_identity_execution_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM public.ingestion_application a
   JOIN public.ingestion_identity_submission s ON s.id=NEW.submission_id
   JOIN public.supplier_offer offer ON offer.id=a.offer_id
   WHERE a.id=NEW.application_id AND a.xmin=pg_current_xact_id()::xid
     AND a.source_id=s.source_id AND a.source_hash=s.source_hash AND a.decision_id=s.decision_id
     AND offer.supplier_id=s.supplier_id
     AND (s.operation='CREATE' OR (a.offer_id=s.offer_id AND a.base_revision_id=s.target_revision_id))
 ) THEN RAISE EXCEPTION 'Identity execution does not match the approved supplier revision'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER ingestion_identity_execution_integrity
 BEFORE INSERT ON public.ingestion_identity_execution
 FOR EACH ROW EXECUTE FUNCTION public.ingestion_identity_execution_integrity();



DO $identity_append_only$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY[
  'ingestion_identity_evidence','ingestion_identity_evidence_revocation',
  'ingestion_identity_submission','ingestion_identity_confirmation','ingestion_identity_execution'
 ] LOOP
   EXECUTE format('CREATE TRIGGER identity_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.ingestion_immutable()', table_name);
 END LOOP;
END;
$identity_append_only$;

GRANT SELECT ON public.ingestion_identity_evidence, public.ingestion_identity_evidence_revocation TO stdu_runtime;
GRANT SELECT, INSERT ON public.ingestion_identity_submission, public.ingestion_identity_confirmation, public.ingestion_identity_execution TO stdu_runtime;

INSERT INTO public.permission(id,code,description) VALUES
 ('a009b003-0000-4000-8000-000000000001','ingestion.reconcile.submit','Submit supplier identity evidence'),
 ('a009b003-0000-4000-8000-000000000002','ingestion.reconcile.approve','Independently approve supplier identity evidence'),
 ('a009b003-0000-4000-8000-000000000003','ingestion.reconcile.execute','Execute an approved supplier identity reconciliation');

DO $reconcile_audit$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.audit_event_valid_r1_002(text,text,text,jsonb)'::regprocedure) INTO definition;
 IF strpos(definition, $anchor$'ingestion.applyEdits'$anchor$)=0 THEN
  RAISE EXCEPTION 'R1-009B edit audit permission anchor missing';
 END IF;
 EXECUTE replace(definition, $anchor$'ingestion.applyEdits'$anchor$,
   $extended$'ingestion.applyEdits','ingestion.reconcile.submit','ingestion.reconcile.approve','ingestion.reconcile.execute'$extended$);
END;
$reconcile_audit$;
COMMIT;
