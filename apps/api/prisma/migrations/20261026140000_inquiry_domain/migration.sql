BEGIN;

-- R1-010B additive Inquiry persistence. This migration does not alter existing
-- catalog, supplier, staff identity or file ownership records.
CREATE TABLE inquiry (
  id uuid PRIMARY KEY,
  public_reference varchar(32) NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT 'PUBLIC_WEB',
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'NEW',
  contact_snapshot jsonb NOT NULL,
  catalog_product_context varchar(120),
  kind_details jsonb NOT NULL,
  upload_profile_code text NOT NULL,
  upload_capability_hash bytea,
  upload_capability_expires_at timestamptz(6),
  assigned_manager_user_id uuid,
  assigned_engineer_user_id uuid,
  stage_due_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_public_reference_check CHECK (length(public_reference) BETWEEN 20 AND 32),
  CONSTRAINT inquiry_channel_check CHECK (channel = 'PUBLIC_WEB'),
  CONSTRAINT inquiry_kind_check CHECK (kind IN ('EQUIPMENT','PANELS','ENGINEERING')),
  CONSTRAINT inquiry_status_check CHECK (status IN ('NEW','TRIAGE','NEEDS_CLARIFICATION','ENGINEERING_REVIEW','READY_FOR_QUOTE','QUOTE_SENT','CLOSED')),
  CONSTRAINT inquiry_contact_snapshot_check CHECK (jsonb_typeof(contact_snapshot) = 'object' AND octet_length(contact_snapshot::text) <= 16384),
  CONSTRAINT inquiry_catalog_context_check CHECK (catalog_product_context IS NULL OR length(catalog_product_context) <= 120),
  CONSTRAINT inquiry_kind_details_check CHECK (jsonb_typeof(kind_details) = 'object' AND octet_length(kind_details::text) <= 32768),
  CONSTRAINT inquiry_upload_profile_check CHECK (upload_profile_code IN ('MVP_SAFE','ENGINEERING_DOCUMENTS')),
  CONSTRAINT inquiry_capability_pair_check CHECK ((upload_capability_hash IS NULL) = (upload_capability_expires_at IS NULL)),
  CONSTRAINT inquiry_capability_hash_check CHECK (upload_capability_hash IS NULL OR octet_length(upload_capability_hash) = 32),
  CONSTRAINT inquiry_manager_fk FOREIGN KEY (assigned_manager_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inquiry_engineer_fk FOREIGN KEY (assigned_engineer_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inquiry_version_check CHECK (version BETWEEN 1 AND 2147483647)
);
CREATE UNIQUE INDEX inquiry_upload_capability_hash_key ON inquiry(upload_capability_hash);
CREATE INDEX inquiry_status_created_id_idx ON inquiry(status, created_at, id);
CREATE INDEX inquiry_status_due_id_idx ON inquiry(status, stage_due_at, id);
CREATE INDEX inquiry_manager_status_created_idx ON inquiry(assigned_manager_user_id, status, created_at, id);
CREATE INDEX inquiry_engineer_status_created_idx ON inquiry(assigned_engineer_user_id, status, created_at, id);

CREATE TABLE inquiry_line (
  id uuid PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES inquiry(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sequence integer NOT NULL,
  raw_title varchar(500) NOT NULL,
  original_sku varchar(160),
  manufacturer_name varchar(200),
  modification varchar(200),
  quantity_text varchar(80) NOT NULL,
  unit_text varchar(40) NOT NULL,
  notes varchar(4000),
  catalog_product_slug_context varchar(160),
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_line_sequence_key UNIQUE (inquiry_id, sequence),
  CONSTRAINT inquiry_line_sequence_check CHECK (sequence BETWEEN 1 AND 50),
  CONSTRAINT inquiry_line_raw_title_check CHECK (length(raw_title) BETWEEN 1 AND 500),
  CONSTRAINT inquiry_line_unit_check CHECK (length(unit_text) BETWEEN 1 AND 40),
  CONSTRAINT inquiry_line_quantity_check CHECK (
    quantity_text ~ '^(0|[1-9][0-9]{0,11})([.,][0-9]{1,6})?$'
    AND CASE WHEN replace(quantity_text, ',', '.') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN replace(quantity_text, ',', '.')::numeric > 0 ELSE false END
  )
);
CREATE INDEX inquiry_line_inquiry_sequence_idx ON inquiry_line(inquiry_id, sequence);

CREATE TABLE inquiry_comment (
  id uuid PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES inquiry(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  author_staff_user_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  visibility text NOT NULL DEFAULT 'INTERNAL',
  body varchar(4000) NOT NULL,
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_event(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_comment_visibility_check CHECK (visibility = 'INTERNAL'),
  CONSTRAINT inquiry_comment_body_check CHECK (length(body) BETWEEN 1 AND 4000 AND body ~ '[^[:space:]]')
);
CREATE INDEX inquiry_comment_inquiry_created_idx ON inquiry_comment(inquiry_id, created_at, id);

CREATE TABLE inquiry_upload_intent (
  id uuid PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES inquiry(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  state text NOT NULL,
  safe_filename varchar(255) NOT NULL,
  declared_mime_type varchar(127) NOT NULL,
  declared_size_bytes bigint NOT NULL,
  expected_sha256 bytea,
  expires_at timestamptz(6) NOT NULL,
  receiving_started_at timestamptz(6),
  receiving_deadline_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_upload_intent_id_inquiry_key UNIQUE (id, inquiry_id),
  CONSTRAINT inquiry_upload_intent_state_check CHECK (state IN ('ISSUED','RECEIVING','CONSUMED','CANCELLED','EXPIRED','REJECTED','FAILED')),
  CONSTRAINT inquiry_upload_intent_filename_check CHECK (length(safe_filename) BETWEEN 1 AND 255 AND safe_filename !~ '[[:cntrl:]/]' AND position(E'\\' in safe_filename) = 0 AND safe_filename NOT IN ('.','..')),
  CONSTRAINT inquiry_upload_intent_size_check CHECK (declared_size_bytes BETWEEN 1 AND 52428800),
  CONSTRAINT inquiry_upload_intent_sha_check CHECK (expected_sha256 IS NULL OR octet_length(expected_sha256) = 32),
  CONSTRAINT inquiry_upload_intent_receiving_pair_check CHECK ((receiving_started_at IS NULL) = (receiving_deadline_at IS NULL)),
  CONSTRAINT inquiry_upload_intent_receiving_state_check CHECK (state <> 'RECEIVING' OR receiving_started_at IS NOT NULL),
  CONSTRAINT inquiry_upload_intent_version_check CHECK (version > 0)
);
CREATE INDEX inquiry_upload_intent_inquiry_state_expiry_idx ON inquiry_upload_intent(inquiry_id, state, expires_at, id);
CREATE INDEX inquiry_upload_intent_state_expiry_idx ON inquiry_upload_intent(state, expires_at, id);

CREATE TABLE inquiry_source_document (
  id uuid PRIMARY KEY,
  inquiry_id uuid NOT NULL REFERENCES inquiry(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  upload_intent_id uuid NOT NULL UNIQUE,
  uploader_kind text NOT NULL DEFAULT 'ANONYMOUS',
  upload_channel text NOT NULL DEFAULT 'PUBLIC_WEB',
  storage_key varchar(128) NOT NULL UNIQUE,
  sha256 bytea NOT NULL,
  size_bytes bigint NOT NULL,
  detected_mime_type varchar(127) NOT NULL,
  original_filename varchar(255) NOT NULL,
  safety_state text NOT NULL DEFAULT 'QUARANTINED',
  uploaded_at timestamptz(6) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_source_document_intent_inquiry_fk FOREIGN KEY (upload_intent_id, inquiry_id) REFERENCES inquiry_upload_intent(id, inquiry_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inquiry_source_document_intent_inquiry_key UNIQUE (upload_intent_id, inquiry_id),
  CONSTRAINT inquiry_source_document_uploader_check CHECK (uploader_kind = 'ANONYMOUS'),
  CONSTRAINT inquiry_source_document_channel_check CHECK (upload_channel = 'PUBLIC_WEB'),
  CONSTRAINT inquiry_source_document_key_check CHECK (storage_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT inquiry_source_document_hash_check CHECK (octet_length(sha256) = 32),
  CONSTRAINT inquiry_source_document_size_check CHECK (size_bytes BETWEEN 1 AND 52428800),
  CONSTRAINT inquiry_source_document_filename_check CHECK (length(original_filename) BETWEEN 1 AND 255 AND original_filename !~ '[[:cntrl:]/]' AND position(E'\\' in original_filename) = 0 AND original_filename NOT IN ('.','..')),
  CONSTRAINT inquiry_source_document_state_check CHECK (safety_state IN ('QUARANTINED','CLEAN','REJECTED','SCAN_ERROR'))
);
CREATE INDEX inquiry_source_document_inquiry_created_idx ON inquiry_source_document(inquiry_id, created_at, id);
CREATE INDEX inquiry_source_document_state_created_idx ON inquiry_source_document(safety_state, created_at, id);

CREATE TABLE inquiry_command_idempotency (
  id uuid PRIMARY KEY,
  actor_kind text NOT NULL,
  actor_staff_user_id uuid REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  operation_scope varchar(80) NOT NULL,
  idempotency_key_hash bytea NOT NULL,
  request_hash bytea NOT NULL,
  http_status smallint NOT NULL,
  response_receipt jsonb NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz(6) NOT NULL,
  CONSTRAINT inquiry_command_idempotency_actor_check CHECK ((actor_kind = 'PUBLIC' AND actor_staff_user_id IS NULL) OR (actor_kind = 'STAFF' AND actor_staff_user_id IS NOT NULL)),
  CONSTRAINT inquiry_command_idempotency_scope_check CHECK (length(operation_scope) BETWEEN 1 AND 80),
  CONSTRAINT inquiry_command_idempotency_key_hash_check CHECK (octet_length(idempotency_key_hash) = 32),
  CONSTRAINT inquiry_command_idempotency_request_hash_check CHECK (octet_length(request_hash) = 32),
  CONSTRAINT inquiry_command_idempotency_status_check CHECK (http_status BETWEEN 200 AND 599),
  CONSTRAINT inquiry_command_idempotency_receipt_check CHECK (jsonb_typeof(response_receipt) = 'object' AND octet_length(response_receipt::text) <= 8192),
  CONSTRAINT inquiry_command_idempotency_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE UNIQUE INDEX inquiry_command_idempotency_public_key_idx
  ON inquiry_command_idempotency(operation_scope, idempotency_key_hash)
  WHERE actor_kind = 'PUBLIC';
CREATE UNIQUE INDEX inquiry_command_idempotency_staff_key_idx
  ON inquiry_command_idempotency(actor_staff_user_id, operation_scope, idempotency_key_hash)
  WHERE actor_kind = 'STAFF';
CREATE INDEX inquiry_command_idempotency_expiry_idx ON inquiry_command_idempotency(expires_at, id);

-- Inquiry audit validation is additive. Preserve the earlier validators by
-- renaming the current dispatch function, then dispatch inquiry.* to its own
-- closed allowlist and everything else to the exact prior implementation.
ALTER FUNCTION audit_event_valid(text,text,text,jsonb) RENAME TO audit_event_valid_pre_r1_010;

CREATE FUNCTION inquiry_audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_entity text;
  v_keys text[];
  v_reasons text[];
  v_actor text;
  v_key text;
  v_value jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_statuses constant text[] := ARRAY['NEW','TRIAGE','NEEDS_CLARIFICATION','ENGINEERING_REVIEW','READY_FOR_QUOTE','QUOTE_SENT','CLOSED'];
  v_fields constant text[] := ARRAY['assignedManagerUserId','assignedEngineerUserId','status','stageDueAt','uploadCapabilityExpiresAt','uploadCapabilityHash','body','safetyState','state'];
  v_sorted jsonb;
BEGIN
  IF p_reason IS NULL THEN RETURN false; END IF;
  CASE p_action
    WHEN 'inquiry.created' THEN v_entity := 'Inquiry'; v_keys := ARRAY[]::text[]; v_actor := 'ANONYMOUS';
    WHEN 'inquiry.upload_intent.created' THEN v_entity := 'InquiryUploadIntent'; v_keys := ARRAY['changedFields','version']; v_actor := 'ANONYMOUS';
    WHEN 'inquiry.upload.completed' THEN v_entity := 'InquirySourceDocument'; v_keys := ARRAY['changedFields','state']; v_actor := 'ANONYMOUS';
    WHEN 'inquiry.upload.rejected' THEN v_entity := 'InquiryUploadIntent'; v_keys := ARRAY['previousState','state','version']; v_actor := 'ANONYMOUS';
    WHEN 'inquiry.upload.cancelled' THEN v_entity := 'InquiryUploadIntent'; v_keys := ARRAY['previousState','state','version']; v_actor := 'ANONYMOUS';
    WHEN 'inquiry.manager.assigned' THEN v_entity := 'Inquiry'; v_keys := ARRAY['targetUserId','changedFields','version']; v_actor := 'STAFF';
    WHEN 'inquiry.engineer.assigned' THEN v_entity := 'Inquiry'; v_keys := ARRAY['targetUserId','changedFields','version']; v_actor := 'STAFF';
    WHEN 'inquiry.transitioned' THEN v_entity := 'Inquiry'; v_keys := ARRAY['previousState','state','version','changedFields']; v_actor := 'STAFF';
    WHEN 'inquiry.closed_without_quote' THEN v_entity := 'Inquiry'; v_keys := ARRAY['previousState','state','version','changedFields']; v_actor := 'STAFF';
    WHEN 'inquiry.stage_deadline.changed' THEN v_entity := 'Inquiry'; v_keys := ARRAY['changedFields','version']; v_actor := 'STAFF';
    WHEN 'inquiry.comment.created' THEN v_entity := 'InquiryComment'; v_keys := ARRAY['changedFields']; v_actor := 'STAFF';
    WHEN 'inquiry.document.downloaded' THEN v_entity := 'InquirySourceDocument'; v_keys := ARRAY[]::text[]; v_actor := 'STAFF';
    WHEN 'inquiry.document.scan_state_changed' THEN v_entity := 'InquirySourceDocument'; v_keys := ARRAY['previousState','state','version']; v_actor := 'OPERATOR';
    ELSE RETURN false;
  END CASE;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_changes)) <> cardinality(v_keys)
     OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE NOT (p_changes ? k)) THEN RETURN false; END IF;
  IF p_action IN ('inquiry.created','inquiry.upload_intent.created','inquiry.upload.completed','inquiry.upload.cancelled','inquiry.document.downloaded') THEN
    IF p_outcome <> 'SUCCESS' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.upload.rejected' THEN
    IF p_outcome NOT IN ('DENIED','FAILURE') THEN RETURN false; END IF;
  ELSE
    IF p_outcome NOT IN ('SUCCESS','DENIED','FAILURE') THEN RETURN false; END IF;
  END IF;
  IF p_action = 'inquiry.created' THEN
    IF p_reason <> 'PUBLIC_SUBMISSION_ACCEPTED' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.upload_intent.created' THEN
    IF p_reason <> 'UPLOAD_INTENT_CREATED' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.upload.completed' THEN
    IF p_reason <> 'UPLOAD_ACCEPTED' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.upload.rejected' THEN
    IF (p_outcome = 'DENIED' AND p_reason NOT IN ('VALIDATION_ERROR','REQUEST_TOO_LARGE','FILE_TYPE_NOT_ALLOWED','MIME_MISMATCH','UPLOAD_QUOTA_EXCEEDED'))
       OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.upload.cancelled' THEN
    IF p_reason <> 'UPLOAD_INTENT_CANCELLED' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.manager.assigned' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason <> 'MANAGER_ASSIGNED') OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.engineer.assigned' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason <> 'ENGINEER_ASSIGNED') OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.transitioned' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason NOT IN ('TRIAGE_STARTED','MORE_INFORMATION_REQUIRED','INFORMATION_RECEIVED','ENGINEERING_STARTED','ENGINEERING_COMPLETE','RETURN_TO_CLARIFICATION')) OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.closed_without_quote' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason NOT IN ('DUPLICATE','CUSTOMER_WITHDRAWN','OUT_OF_SCOPE','SPAM','NOT_FEASIBLE')) OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.stage_deadline.changed' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason NOT IN ('STAGE_DUE_AT_SET','STAGE_DUE_AT_CLEARED')) OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.comment.created' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason <> 'COMMENT_CREATED') OR (p_outcome = 'DENIED' AND p_reason NOT IN ('FORBIDDEN','AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VALIDATION_ERROR','NOT_FOUND')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.document.downloaded' THEN
    IF p_reason <> 'DOWNLOAD_ALLOWED' THEN RETURN false; END IF;
  ELSIF p_action = 'inquiry.document.scan_state_changed' THEN
    IF (p_outcome = 'SUCCESS' AND p_reason NOT IN ('SCAN_CLEAN','SCAN_REJECTED')) OR (p_outcome = 'FAILURE' AND p_reason NOT IN ('SCANNER_UNAVAILABLE','INTERNAL_ERROR')) THEN RETURN false; END IF;
  END IF;

  FOR v_key, v_value IN SELECT key,value FROM jsonb_each(p_changes) LOOP
    IF v_key = 'targetUserId' THEN
      IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' !~* v_uuid_pattern THEN RETURN false; END IF;
    ELSIF v_key = 'version' THEN
      IF jsonb_typeof(v_value) <> 'number' OR v_value #>> '{}' !~ '^[1-9][0-9]*$' OR (v_value #>> '{}')::numeric > 2147483647 THEN RETURN false; END IF;
    ELSIF v_key IN ('state','previousState') THEN
      IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' <> ALL(v_statuses || ARRAY['ISSUED','RECEIVING','CONSUMED','CANCELLED','EXPIRED','REJECTED','FAILED','QUARANTINED','CLEAN','SCAN_ERROR']) THEN RETURN false; END IF;
    ELSIF v_key = 'changedFields' THEN
      IF jsonb_typeof(v_value) <> 'array' OR jsonb_array_length(v_value) > 100 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_value) x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' <> ALL(v_fields)
      ) THEN RETURN false; END IF;
      SELECT COALESCE(jsonb_agg(value ORDER BY value #>> '{}'),'[]'::jsonb) INTO v_sorted
        FROM (SELECT DISTINCT value FROM jsonb_array_elements(v_value)) s;
      IF v_value IS DISTINCT FROM v_sorted THEN RETURN false; END IF;
    END IF;
  END LOOP;
  IF p_action = 'inquiry.upload.completed' AND p_changes->>'state' <> 'QUARANTINED' THEN RETURN false; END IF;
  IF p_action = 'inquiry.document.scan_state_changed' AND p_outcome = 'SUCCESS' AND p_changes->>'state' NOT IN ('CLEAN','REJECTED') THEN RETURN false; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE BEGIN ATOMIC
  SELECT CASE WHEN p_action LIKE 'inquiry.%'
    THEN public.inquiry_audit_event_valid(p_action,p_outcome,p_reason,p_changes)
    ELSE public.audit_event_valid_pre_r1_010(p_action,p_outcome,p_reason,p_changes)
  END;
END;

ALTER TABLE audit_event DROP CONSTRAINT audit_event_registry_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_registry_check
  CHECK (audit_event_valid(action,outcome,reason_code,changes));
ALTER TABLE audit_event DROP CONSTRAINT audit_event_entity_type_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_entity_type_check CHECK (
  entity_type IS NULL OR entity_type IN (
    'StaffUser','Role','StaffSession','SellerLegalEntity','FileObject','FileVersion','FileLink',
    'Brand','Category','AttributeDefinition','CatalogProduct','CatalogProductRevision',
    'ProductAttributeValue','ProductMedia','ProductDocumentVersion','ProductRelation',
    'CatalogImportRun','CatalogImportRow','Supplier','SupplierRevision','SupplierOffer',
    'SupplierOfferRevision','ProductMatchProposal','Inquiry','InquiryLine','InquiryComment',
    'InquirySourceDocument','InquiryUploadIntent'
  )
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_inquiry_actor_check CHECK (
  (action NOT LIKE 'inquiry.%')
  OR (action IN ('inquiry.created','inquiry.upload_intent.created','inquiry.upload.completed','inquiry.upload.rejected','inquiry.upload.cancelled') AND actor_kind = 'ANONYMOUS')
  OR (action = 'inquiry.document.scan_state_changed' AND actor_kind = 'OPERATOR')
  OR (action NOT IN ('inquiry.created','inquiry.upload_intent.created','inquiry.upload.completed','inquiry.upload.rejected','inquiry.upload.cancelled','inquiry.document.scan_state_changed') AND actor_kind = 'STAFF')
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_inquiry_entity_action_check CHECK (
  (action NOT LIKE 'inquiry.%')
  OR (action IN ('inquiry.created','inquiry.manager.assigned','inquiry.engineer.assigned','inquiry.transitioned','inquiry.closed_without_quote','inquiry.stage_deadline.changed') AND entity_type = 'Inquiry')
  OR (action = 'inquiry.comment.created' AND entity_type = 'InquiryComment')
  OR (action IN ('inquiry.upload_intent.created','inquiry.upload.rejected','inquiry.upload.cancelled') AND entity_type = 'InquiryUploadIntent')
  OR (action IN ('inquiry.upload.completed','inquiry.document.downloaded','inquiry.document.scan_state_changed') AND entity_type = 'InquirySourceDocument')
);

-- The approved inquiry permissions are added to the dictionary only; no role
-- assignment or live grant is performed by this migration.
ALTER TABLE permission DROP CONSTRAINT permission_code_check;
ALTER TABLE permission ADD CONSTRAINT permission_code_check CHECK (
  code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
);
INSERT INTO permission(id,code,description) VALUES
  ('40000000-0000-4000-8000-000000000001','inquiries.read_assigned','Read inquiries assigned to the current staff member.'),
  ('40000000-0000-4000-8000-000000000002','inquiries.read_all','Read all staff inquiries.'),
  ('40000000-0000-4000-8000-000000000003','inquiries.contacts.read','Read customer contact snapshots for in-scope inquiries.'),
  ('40000000-0000-4000-8000-000000000004','inquiries.assign_manager','Assign or replace inquiry managers.'),
  ('40000000-0000-4000-8000-000000000005','inquiries.assign_engineer','Assign or replace responsible engineers.'),
  ('40000000-0000-4000-8000-000000000006','inquiries.transition','Transition and manage the current-stage due date for in-scope inquiries.'),
  ('40000000-0000-4000-8000-000000000007','inquiries.comment','Read and append internal inquiry comments.'),
  ('40000000-0000-4000-8000-000000000008','inquiries.documents.read','Read source document metadata and security state.'),
  ('40000000-0000-4000-8000-000000000009','inquiries.documents.download','Download a CLEAN source document in scope when a scanner is operational.');

CREATE FUNCTION inquiry_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiry_updated_at BEFORE UPDATE ON inquiry FOR EACH ROW EXECUTE FUNCTION inquiry_set_updated_at();
CREATE TRIGGER inquiry_upload_intent_updated_at BEFORE UPDATE ON inquiry_upload_intent FOR EACH ROW EXECUTE FUNCTION inquiry_set_updated_at();

CREATE FUNCTION inquiry_upload_intent_integrity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_profile text;
  v_transition_allowed boolean := false;
BEGIN
  -- The application role is untrusted for direct lifecycle/declaration writes.
  -- Privileged migration/fixture owners retain their existing administrative duties.
  IF current_user <> 'stdu_runtime' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.state NOT IN ('EXPIRED','CANCELLED','REJECTED','FAILED')
       OR OLD.expires_at > clock_timestamp() - interval '30 days' THEN
      RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_RETENTION_REQUIRED' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'ISSUED'
       OR NEW.receiving_started_at IS NOT NULL
       OR NEW.receiving_deadline_at IS NOT NULL
       OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_INITIAL_STATE_INVALID' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id
     OR NEW.safe_filename IS DISTINCT FROM OLD.safe_filename
     OR NEW.declared_mime_type IS DISTINCT FROM OLD.declared_mime_type
     OR NEW.declared_size_bytes IS DISTINCT FROM OLD.declared_size_bytes
     OR NEW.expected_sha256 IS DISTINCT FROM OLD.expected_sha256
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_DECLARATION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;

  IF NEW.version <> OLD.version + 1 OR NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;

  v_transition_allowed :=
    (OLD.state = 'ISSUED' AND NEW.state IN ('RECEIVING','CANCELLED','EXPIRED','REJECTED','FAILED'))
    OR (OLD.state = 'RECEIVING' AND NEW.state IN ('CONSUMED','FAILED'));
  IF NOT v_transition_allowed THEN
    RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;

  IF OLD.receiving_started_at IS NULL THEN
    IF NEW.state = 'RECEIVING' THEN
      IF NEW.receiving_started_at IS NULL
         OR NEW.receiving_deadline_at IS NULL
         OR NEW.receiving_started_at > clock_timestamp()
         OR OLD.expires_at <= clock_timestamp()
         OR NEW.receiving_started_at >= OLD.expires_at
         OR NEW.receiving_deadline_at <= NEW.receiving_started_at THEN
        RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_REQUIRED' USING ERRCODE = '55000';
      END IF;
      SELECT upload_profile_code INTO v_profile FROM inquiry WHERE id = OLD.inquiry_id;
      IF (v_profile = 'MVP_SAFE' AND NEW.receiving_deadline_at <> NEW.receiving_started_at + interval '15 minutes')
         OR (v_profile = 'ENGINEERING_DOCUMENTS' AND NEW.receiving_deadline_at <> NEW.receiving_started_at + interval '60 minutes')
         OR v_profile IS NULL THEN
        RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_INVALID' USING ERRCODE = '55000';
      END IF;
    ELSIF NEW.receiving_started_at IS NOT NULL OR NEW.receiving_deadline_at IS NOT NULL THEN
      RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.receiving_started_at IS DISTINCT FROM OLD.receiving_started_at
     OR NEW.receiving_deadline_at IS DISTINCT FROM OLD.receiving_deadline_at THEN
    RAISE EXCEPTION 'INQUIRY_UPLOAD_INTENT_RECEIVING_BOUND_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiry_upload_intent_integrity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON inquiry_upload_intent
  FOR EACH ROW EXECUTE FUNCTION inquiry_upload_intent_integrity_guard();
CREATE TRIGGER inquiry_upload_intent_no_truncate
  BEFORE TRUNCATE ON inquiry_upload_intent
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

CREATE FUNCTION inquiry_immutable_columns_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.public_reference IS DISTINCT FROM OLD.public_reference
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.contact_snapshot IS DISTINCT FROM OLD.contact_snapshot
     OR NEW.catalog_product_context IS DISTINCT FROM OLD.catalog_product_context
     OR NEW.kind_details IS DISTINCT FROM OLD.kind_details
     OR NEW.upload_profile_code IS DISTINCT FROM OLD.upload_profile_code
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INQUIRY_SUBMISSION_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.upload_capability_hash IS DISTINCT FROM OLD.upload_capability_hash
     OR NEW.upload_capability_expires_at IS DISTINCT FROM OLD.upload_capability_expires_at THEN
    IF OLD.upload_capability_hash IS NULL
       OR NEW.upload_capability_hash IS NOT NULL
       OR NEW.upload_capability_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'INQUIRY_UPLOAD_CAPABILITY_IMMUTABLE' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiry_immutable_submission BEFORE UPDATE ON inquiry FOR EACH ROW EXECUTE FUNCTION inquiry_immutable_columns_guard();
CREATE TRIGGER inquiry_line_no_update_delete BEFORE UPDATE OR DELETE ON inquiry_line FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER inquiry_line_no_truncate BEFORE TRUNCATE ON inquiry_line FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE TRIGGER inquiry_comment_no_update_delete BEFORE UPDATE OR DELETE ON inquiry_comment FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER inquiry_comment_no_truncate BEFORE TRUNCATE ON inquiry_comment FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE FUNCTION inquiry_source_document_scan_state_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.safety_state IS DISTINCT FROM 'QUARANTINED' THEN
      RAISE EXCEPTION 'INQUIRY_SOURCE_DOCUMENT_INITIAL_STATE_INVALID' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INQUIRY_SOURCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id
     OR NEW.upload_intent_id IS DISTINCT FROM OLD.upload_intent_id
     OR NEW.uploader_kind IS DISTINCT FROM OLD.uploader_kind
     OR NEW.upload_channel IS DISTINCT FROM OLD.upload_channel
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.detected_mime_type IS DISTINCT FROM OLD.detected_mime_type
     OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
     OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'INQUIRY_SOURCE_DOCUMENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF NEW.safety_state IS NOT DISTINCT FROM OLD.safety_state
     OR NOT (
       (OLD.safety_state = 'QUARANTINED' AND NEW.safety_state IN ('CLEAN','REJECTED','SCAN_ERROR'))
       OR (OLD.safety_state = 'SCAN_ERROR' AND NEW.safety_state IN ('CLEAN','REJECTED'))
     ) THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_STATE_TRANSITION_INVALID' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiry_source_document_scan_state_guard BEFORE INSERT OR UPDATE OR DELETE ON inquiry_source_document FOR EACH ROW EXECUTE FUNCTION inquiry_source_document_scan_state_guard();
CREATE TRIGGER inquiry_source_document_no_truncate BEFORE TRUNCATE ON inquiry_source_document FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE TRIGGER inquiry_command_idempotency_no_update BEFORE UPDATE ON inquiry_command_idempotency FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER inquiry_command_idempotency_no_truncate BEFORE TRUNCATE ON inquiry_command_idempotency FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

GRANT SELECT,INSERT,UPDATE ON inquiry TO stdu_runtime;
GRANT SELECT,INSERT ON inquiry_line,inquiry_comment,inquiry_source_document,inquiry_command_idempotency TO stdu_runtime;
GRANT DELETE ON inquiry_command_idempotency TO stdu_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON inquiry_upload_intent TO stdu_runtime;
GRANT SELECT,INSERT ON audit_event TO stdu_runtime;
GRANT SELECT ON permission TO stdu_runtime;

COMMIT;
