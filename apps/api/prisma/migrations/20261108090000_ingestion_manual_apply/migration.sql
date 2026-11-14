-- R1-009A: additive immutable link between one accepted staging row and one manual offer revision.
CREATE TABLE ingestion_application (
 id uuid PRIMARY KEY,
 source_id uuid NOT NULL REFERENCES ingestion_source(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 run_id uuid NOT NULL REFERENCES ingestion_run(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 row_id varchar(64) NOT NULL REFERENCES ingestion_row(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 decision_id uuid NOT NULL REFERENCES ingestion_decision(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 actor_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 offer_id uuid NOT NULL REFERENCES supplier_offer(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 base_revision_id uuid NOT NULL REFERENCES supplier_offer_revision(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 revision_id uuid NOT NULL REFERENCES supplier_offer_revision(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 source_hash varchar(64) NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 version integer NOT NULL CHECK(version > 1),
 created_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT ingestion_application_row_key UNIQUE(row_id),
 CONSTRAINT ingestion_application_decision_key UNIQUE(decision_id),
 CONSTRAINT ingestion_application_revision_key UNIQUE(revision_id),
 CONSTRAINT ingestion_application_revisions_differ CHECK(base_revision_id <> revision_id)
);

CREATE FUNCTION ingestion_application_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER ingestion_application_integrity BEFORE INSERT ON ingestion_application
 FOR EACH ROW EXECUTE FUNCTION ingestion_application_integrity();
CREATE TRIGGER ingestion_application_immutable BEFORE UPDATE OR DELETE ON ingestion_application
 FOR EACH ROW EXECUTE FUNCTION ingestion_immutable();
GRANT SELECT,INSERT ON ingestion_application TO stdu_runtime;
