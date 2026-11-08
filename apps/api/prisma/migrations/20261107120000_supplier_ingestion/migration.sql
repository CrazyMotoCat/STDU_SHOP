-- CreateTable
CREATE TABLE "ingestion_source" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "adapter_version" VARCHAR(40) NOT NULL,
    "fixture_key" VARCHAR(40) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "max_rows" INTEGER NOT NULL,
    "max_attempts" INTEGER NOT NULL,
    "timeout_ms" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_source_revision" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_source_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_run" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "source_version" INTEGER NOT NULL,
    "source_snapshot" JSONB NOT NULL,
    "actor_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "raw_snapshot" BYTEA,
    "source_hash" VARCHAR(64),
    "diagnostic_code" VARCHAR(40),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "ingestion_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_row" (
    "id" VARCHAR(64) NOT NULL,
    "run_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "source_hash" VARCHAR(64) NOT NULL,
    "normalized" JSONB,
    "warnings" JSONB NOT NULL,
    "modification_evidence" VARCHAR(16),
    "error_code" VARCHAR(32),
    "review_state" VARCHAR(16) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_decision" (
    "id" UUID NOT NULL,
    "row_id" VARCHAR(64) NOT NULL,
    "actor_id" UUID NOT NULL,
    "decision" VARCHAR(16) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_command" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_command_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_outbox" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "dispatches" INTEGER NOT NULL DEFAULT 0,
    "next_dispatch_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "ingestion_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_source_revision_version_key" ON "ingestion_source_revision"("source_id", "version");

-- CreateIndex
CREATE INDEX "ingestion_run_recovery_idx" ON "ingestion_run"("state", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_row_coordinate_key" ON "ingestion_row"("run_id", "row_number");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_decision_row_key" ON "ingestion_decision"("row_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_command_actor_key" ON "ingestion_command"("actor_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_outbox_run_key" ON "ingestion_outbox"("run_id");

-- CreateIndex
CREATE INDEX "ingestion_outbox_due_idx" ON "ingestion_outbox"("next_dispatch_at");

-- AddForeignKey
ALTER TABLE "ingestion_source" ADD CONSTRAINT "ingestion_source_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_source" ADD CONSTRAINT "ingestion_source_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_source_revision" ADD CONSTRAINT "ingestion_source_revision_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ingestion_source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "ingestion_source"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_row" ADD CONSTRAINT "ingestion_row_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_decision" ADD CONSTRAINT "ingestion_decision_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "ingestion_row"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_decision" ADD CONSTRAINT "ingestion_decision_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_command" ADD CONSTRAINT "ingestion_command_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ingestion_outbox" ADD CONSTRAINT "ingestion_outbox_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Additive R1-008B constraints and default-deny permissions.
ALTER TABLE ingestion_source ADD CONSTRAINT ingestion_source_policy CHECK (
 adapter_version='fixture-json/1' AND fixture_key IN ('offers-v1','mixed-v1')
 AND state IN ('ENABLED','DISABLED') AND version>0 AND max_rows BETWEEN 1 AND 100
 AND max_attempts BETWEEN 1 AND 5 AND timeout_ms BETWEEN 100 AND 10000);
ALTER TABLE ingestion_source_revision ADD CONSTRAINT ingestion_revision_shape CHECK (version>0 AND jsonb_typeof(snapshot)='object');
ALTER TABLE ingestion_source_revision ADD FOREIGN KEY(actor_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ingestion_run ADD CONSTRAINT ingestion_run_source_revision_fk FOREIGN KEY(source_id,source_version)
 REFERENCES ingestion_source_revision(source_id,version) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ingestion_run ADD CONSTRAINT ingestion_run_counts CHECK (
 processed BETWEEN 0 AND 100 AND candidate_count>=0 AND error_count>=0
 AND processed=candidate_count+error_count AND attempts BETWEEN 0 AND 5 AND version>0);
ALTER TABLE ingestion_run ADD CONSTRAINT ingestion_run_state CHECK (
 state IN ('QUEUED','RUNNING','RETRY_WAIT','COMPLETE','PARTIAL','FAILED')
 AND ((state='RUNNING')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
 AND ((state IN ('COMPLETE','PARTIAL','FAILED'))=(finished_at IS NOT NULL))
 AND (state<>'COMPLETE' OR error_count=0) AND (state<>'PARTIAL' OR error_count>0));
ALTER TABLE ingestion_run ADD CONSTRAINT ingestion_run_snapshot CHECK (
 (raw_snapshot IS NULL AND source_hash IS NULL)
 OR (raw_snapshot IS NOT NULL AND source_hash IS NOT NULL AND source_hash=encode(sha256(raw_snapshot),'hex') AND octet_length(raw_snapshot)<=1048576));
ALTER TABLE ingestion_run ADD CONSTRAINT ingestion_run_hash_key UNIQUE(id,source_hash);
ALTER TABLE ingestion_row ADD CONSTRAINT ingestion_row_hash_fk FOREIGN KEY(run_id,source_hash)
 REFERENCES ingestion_run(id,source_hash) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE ingestion_row ADD CONSTRAINT ingestion_row_shape CHECK (
 id ~ '^[a-f0-9]{64}$' AND row_number BETWEEN 1 AND 100 AND version>0
 AND jsonb_typeof(warnings)='array' AND jsonb_array_length(warnings)<=8
 AND ((error_code IS NULL AND normalized IS NOT NULL AND jsonb_typeof(normalized)='object'
       AND modification_evidence IS NOT NULL AND modification_evidence IN ('SPECIFIED','UNKNOWN') AND review_state IN ('PENDING','ACCEPTED','REJECTED'))
 OR (error_code IS NOT NULL AND error_code='ROW_INVALID' AND normalized IS NULL AND modification_evidence IS NULL AND review_state='NOT_APPLICABLE')));
ALTER TABLE ingestion_decision ADD CONSTRAINT ingestion_decision_shape CHECK (decision IN ('ACCEPT','REJECT') AND length(btrim(reason)) BETWEEN 1 AND 500);
ALTER TABLE ingestion_command ADD CONSTRAINT ingestion_command_shape CHECK (
 length(key) BETWEEN 8 AND 128 AND request_hash ~ '^[a-f0-9]{64}$' AND response_status IN (200,201,409)
 AND jsonb_typeof(response_body)='object');
ALTER TABLE ingestion_outbox ADD CONSTRAINT ingestion_outbox_dispatches CHECK(dispatches>=0);

CREATE FUNCTION ingestion_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'R1-008B immutable history'; END; $$;
CREATE TRIGGER ingestion_revision_immutable BEFORE UPDATE OR DELETE ON ingestion_source_revision FOR EACH ROW EXECUTE FUNCTION ingestion_immutable();
CREATE TRIGGER ingestion_decision_immutable BEFORE UPDATE OR DELETE ON ingestion_decision FOR EACH ROW EXECUTE FUNCTION ingestion_immutable();
CREATE TRIGGER ingestion_command_immutable BEFORE UPDATE OR DELETE ON ingestion_command FOR EACH ROW EXECUTE FUNCTION ingestion_immutable();

CREATE FUNCTION ingestion_run_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R1-008B history retained'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS (SELECT 1 FROM ingestion_source_revision s WHERE s.source_id=NEW.source_id AND s.version=NEW.source_version AND s.snapshot=NEW.source_snapshot)
   THEN RAISE EXCEPTION 'R1-008B snapshot mismatch'; END IF;
 ELSE
  IF OLD.state IN ('COMPLETE','PARTIAL','FAILED') OR
   (OLD.id,OLD.source_id,OLD.source_version,OLD.source_snapshot,OLD.actor_id,OLD.request_id,OLD.created_at)
   IS DISTINCT FROM (NEW.id,NEW.source_id,NEW.source_version,NEW.source_snapshot,NEW.actor_id,NEW.request_id,NEW.created_at)
   OR (OLD.raw_snapshot IS NOT NULL AND (OLD.raw_snapshot,OLD.source_hash) IS DISTINCT FROM (NEW.raw_snapshot,NEW.source_hash))
   THEN RAISE EXCEPTION 'R1-008B immutable provenance'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ingestion_run_integrity BEFORE INSERT OR UPDATE OR DELETE ON ingestion_run FOR EACH ROW EXECUTE FUNCTION ingestion_run_integrity();

CREATE FUNCTION ingestion_source_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R1-008B history retained'; END IF;
 IF (OLD.id,OLD.supplier_id,OLD.actor_id,OLD.adapter_version,OLD.fixture_key,OLD.created_at)
 IS DISTINCT FROM (NEW.id,NEW.supplier_id,NEW.actor_id,NEW.adapter_version,NEW.fixture_key,NEW.created_at)
 OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'R1-008B invalid source revision'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ingestion_source_integrity BEFORE UPDATE OR DELETE ON ingestion_source FOR EACH ROW EXECUTE FUNCTION ingestion_source_integrity();

CREATE FUNCTION ingestion_row_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'R1-008B history retained'; END IF;
 IF (OLD.id,OLD.run_id,OLD.row_number,OLD.source_hash,OLD.normalized,OLD.warnings,OLD.modification_evidence,OLD.error_code,OLD.created_at)
 IS DISTINCT FROM (NEW.id,NEW.run_id,NEW.row_number,NEW.source_hash,NEW.normalized,NEW.warnings,NEW.modification_evidence,NEW.error_code,NEW.created_at)
 OR OLD.review_state<>'PENDING' OR NEW.version<>OLD.version+1 OR NOT EXISTS (
  SELECT 1 FROM ingestion_decision d WHERE d.row_id=OLD.id AND NEW.review_state=CASE d.decision WHEN 'ACCEPT' THEN 'ACCEPTED' ELSE 'REJECTED' END
 ) THEN RAISE EXCEPTION 'R1-008B immutable candidate'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ingestion_row_integrity BEFORE UPDATE OR DELETE ON ingestion_row FOR EACH ROW EXECUTE FUNCTION ingestion_row_integrity();

CREATE FUNCTION ingestion_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM ingestion_row WHERE id=NEW.row_id AND review_state='PENDING' AND error_code IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'R1-008B candidate is not pending'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER ingestion_decision_guard BEFORE INSERT ON ingestion_decision FOR EACH ROW EXECUTE FUNCTION ingestion_decision_guard();

-- Preserve existing audit validation by delegating all prior namespaces.
ALTER FUNCTION audit_event_valid(text,text,text,jsonb) RENAME TO audit_event_valid_pre_r1_008b;
CREATE FUNCTION audit_event_valid(p_action text,p_outcome text,p_reason text,p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF p_action NOT LIKE 'ingestion.%' THEN
  RETURN public.audit_event_valid_pre_r1_008b(p_action,p_outcome,p_reason,p_changes);
 END IF;
 IF p_action NOT IN ('ingestion.source.created','ingestion.source.changed','ingestion.run.requested',
  'ingestion.command.denied','ingestion.run.started','ingestion.run.snapshot','ingestion.run.completed',
  'ingestion.run.retry','ingestion.run.failed','ingestion.row.decided') OR p_reason IS NULL OR
  p_reason NOT IN ('CREATED','CHANGED','REQUESTED','STARTED','SNAPSHOT_CAPTURED','COMPLETE','PARTIAL',
  'EXTRACTION_FAILED','SOURCE_DISABLED','SOURCE_CHANGED','SUPPLIER_INACTIVE','ATTEMPTS_EXHAUSTED',
  'ACCEPT','REJECT','AUTH_REQUIRED','FORBIDDEN','PASSWORD_CHANGE_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN',
  'VERSION_CONFLICT','INVALID_STATE_TRANSITION','IDEMPOTENCY_KEY_REUSED','NOT_FOUND','VALIDATION_ERROR') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_changes) WHERE key NOT IN ('sourceId','runId','rowId','version','attempts','processed','candidateCount','errorCount')) THEN RETURN false; END IF;
 RETURN p_outcome IN ('SUCCESS','DENIED','FAILURE') AND jsonb_typeof(p_changes)='object';
END; $$;
ALTER TABLE audit_event DROP CONSTRAINT audit_event_registry_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_registry_check CHECK(audit_event_valid(action,outcome,reason_code,changes));
ALTER TABLE audit_event DROP CONSTRAINT audit_event_entity_type_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_entity_type_check CHECK(entity_type IS NULL OR entity_type IN (
 'StaffUser','Role','StaffSession','SellerLegalEntity','FileObject','FileVersion','FileLink','Brand','Category','AttributeDefinition',
 'CatalogProduct','CatalogProductRevision','ProductAttributeValue','ProductMedia','ProductDocumentVersion','ProductRelation',
 'CatalogImportRun','CatalogImportRow','Supplier','SupplierRevision','SupplierOffer','SupplierOfferRevision','ProductMatchProposal',
 'Inquiry','InquiryLine','InquiryComment','InquirySourceDocument','InquiryUploadIntent',
 'IngestionSource','IngestionRun','IngestionDecision'));
ALTER TABLE audit_event ADD CONSTRAINT ingestion_audit_actor CHECK(action NOT LIKE 'ingestion.%' OR
 (action IN ('ingestion.run.started','ingestion.run.snapshot','ingestion.run.completed','ingestion.run.retry','ingestion.run.failed')
 AND actor_kind='OPERATOR' AND operator_label='supplier-ingestion-worker')
 OR (action IN ('ingestion.source.created','ingestion.source.changed','ingestion.run.requested','ingestion.row.decided') AND actor_kind='STAFF')
 OR action='ingestion.command.denied');

INSERT INTO permission(id,code,description) VALUES
 ('a008b001-0000-4000-8000-000000000001','ingestion.read','Read supplier ingestion staging'),
 ('a008b001-0000-4000-8000-000000000002','ingestion.sources.write','Manage approved ingestion sources'),
 ('a008b001-0000-4000-8000-000000000003','ingestion.run','Manually request supplier ingestion'),
 ('a008b001-0000-4000-8000-000000000004','ingestion.review','Decide one staging candidate');
-- Existing role commands retain their grant ceiling. Only the audit enum grows.
DO $ingestion_audit_permissions$
DECLARE definition text;
DECLARE extended text;
BEGIN
 SELECT pg_get_functiondef('public.audit_event_valid_r1_002(text,text,text,jsonb)'::regprocedure) INTO definition;
 extended := replace(definition,
   $anchor$'catalog.products.documents.write'
  ];$anchor$,
   $add$'catalog.products.documents.write',
    'ingestion.read','ingestion.sources.write','ingestion.run','ingestion.review'
  ];$add$);
 IF extended = definition THEN RAISE EXCEPTION 'R1-008B audit permission extension anchor missing'; END IF;
 EXECUTE extended;
END;
$ingestion_audit_permissions$;
GRANT SELECT,INSERT,UPDATE ON ingestion_source,ingestion_run,ingestion_row,ingestion_outbox TO stdu_runtime;
GRANT SELECT,INSERT ON ingestion_source_revision,ingestion_decision,ingestion_command TO stdu_runtime;
