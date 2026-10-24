BEGIN;

ALTER TABLE file_object
  ADD CONSTRAINT file_object_id_owner_key UNIQUE (id, owner_staff_user_id);

-- Additive persistence for the frozen R1-006 import workflow. The migration
-- deliberately creates no permission codes and never alters existing catalog
-- tables or history.
CREATE TABLE catalog_import_run (
  id uuid PRIMARY KEY,
  uploader_staff_user_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  source_file_object_id uuid NOT NULL,
  source_file_version_id uuid NOT NULL,
  source_format text NOT NULL,
  source_encoding text,
  source_delimiter text,
  state text NOT NULL,
  mapping jsonb,
  parser_version varchar(32) NOT NULL,
  source_parse_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping_version integer NOT NULL DEFAULT 0,
  upload_idempotency_key uuid NOT NULL,
  upload_request_hash bytea NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT catalog_import_run_source_file_version_fk
    FOREIGN KEY (source_file_version_id, source_file_object_id)
    REFERENCES file_version(id, file_object_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_import_run_source_file_owner_fk
    FOREIGN KEY (source_file_object_id, uploader_staff_user_id)
    REFERENCES file_object(id, owner_staff_user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_import_run_uploader_key_key UNIQUE (uploader_staff_user_id, upload_idempotency_key),
  CONSTRAINT catalog_import_run_format_check CHECK (source_format IN ('CSV','XLSX')),
  CONSTRAINT catalog_import_run_options_check CHECK (
    (source_format = 'CSV' AND source_encoding IS NOT NULL
      AND source_encoding IN ('UTF-8','WINDOWS-1251')
      AND source_delimiter IS NOT NULL
      AND source_delimiter IN (',',';', E'\t'))
    OR (source_format = 'XLSX' AND source_encoding IS NULL AND source_delimiter IS NULL)
  ),
  CONSTRAINT catalog_import_run_state_check CHECK (state IN (
    'SOURCE_READY','SOURCE_PARTIAL','MAPPED','PREVIEWING','PREVIEW_READY',
    'PREVIEW_PARTIAL','COMPLETED','COMPLETED_WITH_ISSUES'
  )),
  CONSTRAINT catalog_import_run_mapping_check CHECK (
    mapping IS NULL OR (jsonb_typeof(mapping) = 'object' AND octet_length(mapping::text) <= 2097152)
  ),
  CONSTRAINT catalog_import_run_parse_issues_check CHECK (
    jsonb_typeof(source_parse_issues) = 'array' AND octet_length(source_parse_issues::text) <= 16384
  ),
  CONSTRAINT catalog_import_run_hash_check CHECK (octet_length(upload_request_hash) = 32),
  CONSTRAINT catalog_import_run_mapping_version_check CHECK (mapping_version >= 0),
  CONSTRAINT catalog_import_run_version_check CHECK (version > 0)
);
CREATE INDEX catalog_import_run_owner_created_id_idx
  ON catalog_import_run(uploader_staff_user_id, created_at, id);
CREATE INDEX catalog_import_run_state_updated_id_idx
  ON catalog_import_run(state, updated_at, id);

CREATE TABLE catalog_import_row (
  id uuid PRIMARY KEY,
  import_run_id uuid NOT NULL REFERENCES catalog_import_run(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  sheet_index integer NOT NULL,
  sheet_name varchar(128),
  source_row_number integer NOT NULL,
  source_cells jsonb NOT NULL,
  normalized_candidate jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_state text NOT NULL,
  matched_product_id uuid REFERENCES catalog_product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  expected_product_version integer,
  expected_current_revision_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT catalog_import_row_expected_revision_fk
    FOREIGN KEY (expected_current_revision_id, matched_product_id)
    REFERENCES catalog_product_revision(id, product_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_import_row_source_coordinate_key
    UNIQUE (import_run_id, sheet_index, source_row_number),
  CONSTRAINT catalog_import_row_sheet_index_check CHECK (sheet_index BETWEEN 0 AND 19),
  CONSTRAINT catalog_import_row_source_number_check CHECK (source_row_number > 0),
  CONSTRAINT catalog_import_row_sheet_name_check CHECK (sheet_name IS NULL OR length(sheet_name) <= 128),
  CONSTRAINT catalog_import_row_state_check CHECK (candidate_state IN (
    'INVALID','NEEDS_MAPPING','HEADER','IGNORED','NEW','EXACT_MATCH',
    'NO_DEDUP_KEY','DUPLICATE_IN_RUN','ARCHIVED_MATCH','CONFLICT','APPLIED','REJECTED','HELD'
  )),
  CONSTRAINT catalog_import_row_payload_check CHECK (
    jsonb_typeof(source_cells) = 'array' AND jsonb_array_length(source_cells) <= 128
    AND octet_length(source_cells::text) <= 1048576
    AND jsonb_typeof(normalized_candidate) = 'object' AND octet_length(normalized_candidate::text) <= 65536
    AND jsonb_typeof(validation_issues) = 'array' AND octet_length(validation_issues::text) <= 16384
    AND jsonb_typeof(warnings) = 'array' AND octet_length(warnings::text) <= 16384
  ),
  CONSTRAINT catalog_import_row_expected_version_check CHECK (
    (matched_product_id IS NULL AND expected_product_version IS NULL AND expected_current_revision_id IS NULL)
    OR (matched_product_id IS NOT NULL AND expected_product_version > 0)
  ),
  CONSTRAINT catalog_import_row_version_check CHECK (version > 0)
);
CREATE INDEX catalog_import_row_state_updated_id_idx
  ON catalog_import_row(candidate_state, updated_at, id);
CREATE INDEX catalog_import_row_product_id_idx
  ON catalog_import_row(matched_product_id, id);

CREATE TABLE catalog_import_decision (
  id uuid PRIMARY KEY,
  row_id uuid NOT NULL REFERENCES catalog_import_row(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  actor_staff_user_id uuid NOT NULL REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_hash bytea NOT NULL,
  expected_row_version integer NOT NULL,
  mapping_version integer NOT NULL,
  action text NOT NULL,
  outcome text NOT NULL,
  conflict_code varchar(40),
  target_product_id uuid REFERENCES catalog_product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  result_revision_id uuid,
  audit_event_id uuid NOT NULL UNIQUE REFERENCES audit_event(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  reason_code varchar(40),
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT catalog_import_decision_result_revision_fk
    FOREIGN KEY (result_revision_id, target_product_id)
    REFERENCES catalog_product_revision(id, product_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_import_decision_row_key_key UNIQUE (row_id, idempotency_key),
  CONSTRAINT catalog_import_decision_hash_check CHECK (octet_length(request_hash) = 32),
  CONSTRAINT catalog_import_decision_expected_row_check CHECK (expected_row_version > 0),
  CONSTRAINT catalog_import_decision_mapping_version_check CHECK (mapping_version >= 0),
  CONSTRAINT catalog_import_decision_action_check CHECK (action IN ('ACCEPT_CREATE','ACCEPT_REVISION','REJECT','HOLD')),
  CONSTRAINT catalog_import_decision_outcome_check CHECK (outcome IN ('APPLIED','REJECTED','HELD','CONFLICT')),
  CONSTRAINT catalog_import_decision_conflict_check CHECK (
    (outcome = 'CONFLICT' AND conflict_code IS NOT NULL
      AND conflict_code IN ('IMPORT_ROW_CONFLICT','IDENTITY_CONFLICT')
      AND target_product_id IS NULL AND result_revision_id IS NULL)
    OR (outcome <> 'CONFLICT' AND conflict_code IS NULL)
  ),
  CONSTRAINT catalog_import_decision_reason_check CHECK (
    reason_code IS NULL OR reason_code IN ('DUPLICATE_REVIEWED','SOURCE_INCOMPLETE','DATA_CORRECTED','OTHER')
  )
);
CREATE INDEX catalog_import_decision_row_created_id_idx
  ON catalog_import_decision(row_id, created_at, id);
CREATE INDEX catalog_import_decision_actor_created_id_idx
  ON catalog_import_decision(actor_staff_user_id, created_at, id);

-- These integrity triggers need row locks while the runtime role intentionally
-- lacks UPDATE privileges on shared file and audit tables. Keep the lock/read
-- checks inside narrowly scoped definer functions with a fixed search path.
CREATE FUNCTION enforce_catalog_import_file_private() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  object_owner uuid;
  object_visibility text;
BEGIN
  SELECT owner_staff_user_id, visibility INTO object_owner, object_visibility
  FROM public.file_object WHERE id=NEW.source_file_object_id FOR SHARE;
  IF object_owner IS DISTINCT FROM NEW.uploader_staff_user_id OR object_visibility IS DISTINCT FROM 'PRIVATE' THEN
    RAISE EXCEPTION 'IMPORT_SOURCE_FILE_MUST_BE_PRIVATE_AND_OWNED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_import_run_private_source
  BEFORE INSERT OR UPDATE ON catalog_import_run
  FOR EACH ROW EXECUTE FUNCTION enforce_catalog_import_file_private();

CREATE FUNCTION prevent_import_source_file_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visibility IS DISTINCT FROM 'PRIVATE' AND EXISTS (
    SELECT 1 FROM catalog_import_run WHERE source_file_object_id=OLD.id
  ) THEN
    RAISE EXCEPTION 'IMPORT_SOURCE_FILE_MUST_REMAIN_PRIVATE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER file_object_import_source_private
  BEFORE UPDATE OF visibility ON file_object FOR EACH ROW
  EXECUTE FUNCTION prevent_import_source_file_publication();

CREATE FUNCTION validate_catalog_import_decision_audit() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  event public.audit_event%ROWTYPE;
  run_id uuid;
BEGIN
  SELECT r.import_run_id INTO run_id
  FROM public.catalog_import_row r WHERE r.id=NEW.row_id;
  SELECT * INTO event
  FROM public.audit_event WHERE id=NEW.audit_event_id FOR KEY SHARE;
  IF NEW.outcome='CONFLICT' THEN
    IF event.action IS DISTINCT FROM 'catalog.import.row.decided'
      OR event.actor_kind IS DISTINCT FROM 'STAFF'
      OR event.actor_user_id IS DISTINCT FROM NEW.actor_staff_user_id
      OR event.outcome IS DISTINCT FROM 'DENIED'
      OR event.reason_code IS DISTINCT FROM NEW.conflict_code
      OR event.entity_type IS DISTINCT FROM 'CatalogImportRow'
      OR event.entity_id IS DISTINCT FROM NEW.row_id
      OR event.changes->>'runId' IS DISTINCT FROM run_id::text
      OR event.changes->>'action' IS DISTINCT FROM NEW.action
      OR event.changes->>'outcome' IS DISTINCT FROM 'CONFLICT'
      OR event.changes->'targetProductId' IS DISTINCT FROM 'null'::jsonb
      OR event.changes->'resultRevisionId' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'IMPORT_CONFLICT_AUDIT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF event.action IS DISTINCT FROM 'catalog.import.row.decided'
      OR event.actor_kind IS DISTINCT FROM 'STAFF'
      OR event.actor_user_id IS DISTINCT FROM NEW.actor_staff_user_id
      OR event.outcome IS DISTINCT FROM 'SUCCESS'
      OR event.reason_code IS DISTINCT FROM NEW.outcome
      OR event.entity_type IS DISTINCT FROM 'CatalogImportRow'
      OR event.entity_id IS DISTINCT FROM NEW.row_id
      OR event.changes->>'runId' IS DISTINCT FROM run_id::text
      OR event.changes->>'action' IS DISTINCT FROM NEW.action
      OR event.changes->>'outcome' IS DISTINCT FROM NEW.outcome
      OR event.changes->'targetProductId' IS DISTINCT FROM to_jsonb(NEW.target_product_id)
      OR event.changes->'resultRevisionId' IS DISTINCT FROM to_jsonb(NEW.result_revision_id) THEN
      RAISE EXCEPTION 'IMPORT_SUCCESS_AUDIT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_import_decision_audit_guard
  BEFORE INSERT ON catalog_import_decision FOR EACH ROW
  EXECUTE FUNCTION validate_catalog_import_decision_audit();

CREATE FUNCTION guard_catalog_import_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.uploader_staff_user_id, OLD.source_file_object_id, OLD.source_file_version_id,
         OLD.source_format, OLD.source_encoding, OLD.source_delimiter, OLD.parser_version,
         OLD.source_parse_issues, OLD.upload_idempotency_key, OLD.upload_request_hash, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.uploader_staff_user_id, NEW.source_file_object_id, NEW.source_file_version_id,
         NEW.source_format, NEW.source_encoding, NEW.source_delimiter, NEW.parser_version,
         NEW.source_parse_issues, NEW.upload_idempotency_key, NEW.upload_request_hash, NEW.created_at) THEN
    RAISE EXCEPTION 'IMPORT_SOURCE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.mapping IS DISTINCT FROM NEW.mapping AND EXISTS (
    SELECT 1 FROM catalog_import_row
    WHERE import_run_id = OLD.id AND candidate_state IN ('APPLIED','REJECTED')
  ) THEN
    RAISE EXCEPTION 'IMPORT_MAPPING_LOCKED' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_import_run_guard_update
  BEFORE UPDATE ON catalog_import_run FOR EACH ROW EXECUTE FUNCTION guard_catalog_import_run_update();
CREATE TRIGGER catalog_import_run_no_delete
  BEFORE DELETE ON catalog_import_run FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();

CREATE FUNCTION guard_catalog_import_row_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.import_run_id, OLD.sheet_index, OLD.sheet_name, OLD.source_row_number, OLD.source_cells, OLD.created_at)
     IS DISTINCT FROM
     ROW(NEW.import_run_id, NEW.sheet_index, NEW.sheet_name, NEW.source_row_number, NEW.source_cells, NEW.created_at) THEN
    RAISE EXCEPTION 'IMPORT_SOURCE_ROW_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_import_row_guard_update
  BEFORE UPDATE ON catalog_import_row FOR EACH ROW EXECUTE FUNCTION guard_catalog_import_row_update();
CREATE TRIGGER catalog_import_row_no_delete
  BEFORE DELETE ON catalog_import_row FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER catalog_import_decision_no_update_delete
  BEFORE UPDATE OR DELETE ON catalog_import_decision FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER catalog_import_decision_no_truncate
  BEFORE TRUNCATE ON catalog_import_decision FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

CREATE FUNCTION catalog_import_audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  allowed_keys text[];
  allowed_reasons text[];
  key text;
  value jsonb;
BEGIN
  CASE p_action
    WHEN 'catalog.import.created' THEN
      allowed_keys := ARRAY['sourceSha256','sourceFormat','sizeBytes','state','parserVersion','parsedRowCount','sourceParseIssueCount'];
      allowed_reasons := CASE p_outcome WHEN 'SUCCESS' THEN ARRAY[NULL] WHEN 'DENIED' THEN ARRAY['AUTH_REQUIRED','FORBIDDEN','ORIGIN_FORBIDDEN','CSRF_INVALID','VALIDATION_ERROR','FILE_REJECTED','FILE_TOO_LARGE','UNSUPPORTED_MEDIA_TYPE','IDEMPOTENCY_KEY_REUSED'] WHEN 'FAILURE' THEN ARRAY['DEPENDENCY_UNAVAILABLE','AUDIT_UNAVAILABLE','INTERNAL_ERROR'] ELSE ARRAY[]::text[] END;
    WHEN 'catalog.import.mapping.changed' THEN
      allowed_keys := ARRAY['mappingVersion','mappingHash','mappedFieldCount','version'];
      allowed_reasons := CASE p_outcome WHEN 'SUCCESS' THEN ARRAY[NULL] WHEN 'DENIED' THEN ARRAY['AUTH_REQUIRED','FORBIDDEN','ORIGIN_FORBIDDEN','CSRF_INVALID','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','INVALID_STATE_TRANSITION'] WHEN 'FAILURE' THEN ARRAY['DEPENDENCY_UNAVAILABLE','AUDIT_UNAVAILABLE','INTERNAL_ERROR'] ELSE ARRAY[]::text[] END;
    WHEN 'catalog.import.preview.completed' THEN
      allowed_keys := ARRAY['state','parsedRowCount','invalidRowCount','warningRowCount','parserVersion'];
      allowed_reasons := CASE p_outcome WHEN 'SUCCESS' THEN ARRAY['PREVIEW_READY','PREVIEW_PARTIAL'] WHEN 'DENIED' THEN ARRAY['AUTH_REQUIRED','FORBIDDEN','ORIGIN_FORBIDDEN','CSRF_INVALID','VALIDATION_ERROR','NOT_FOUND','INVALID_STATE_TRANSITION','IMPORT_LIMIT_EXCEEDED','ENCODING_REQUIRED','INVALID_ENCODING','FILE_REJECTED'] WHEN 'FAILURE' THEN ARRAY['DEPENDENCY_UNAVAILABLE','INGESTION_UNAVAILABLE','AUDIT_UNAVAILABLE','INTERNAL_ERROR'] ELSE ARRAY[]::text[] END;
    WHEN 'catalog.import.row.decided' THEN
      allowed_keys := ARRAY['runId','sheetIndex','sourceRowNumber','action','outcome','targetProductId','resultRevisionId','expectedRowVersion','expectedProductVersion'];
      allowed_reasons := CASE p_outcome WHEN 'SUCCESS' THEN ARRAY['APPLIED','REJECTED','HELD'] WHEN 'DENIED' THEN ARRAY['AUTH_REQUIRED','FORBIDDEN','ORIGIN_FORBIDDEN','CSRF_INVALID','VALIDATION_ERROR','NOT_FOUND','VERSION_CONFLICT','IMPORT_ROW_CONFLICT','IDENTITY_CONFLICT','INVALID_STATE_TRANSITION','IDEMPOTENCY_KEY_REUSED'] WHEN 'FAILURE' THEN ARRAY['DEPENDENCY_UNAVAILABLE','AUDIT_UNAVAILABLE','INTERNAL_ERROR'] ELSE ARRAY[]::text[] END;
    WHEN 'catalog.import.cross_owner.accessed' THEN
      allowed_keys := ARRAY['runId','rowId','ownerStaffUserId','accessKind'];
      allowed_reasons := CASE p_outcome WHEN 'SUCCESS' THEN ARRAY['READ','MUTATION'] WHEN 'DENIED' THEN ARRAY['AUTH_REQUIRED','FORBIDDEN','NOT_FOUND'] WHEN 'FAILURE' THEN ARRAY['AUDIT_UNAVAILABLE','INTERNAL_ERROR'] ELSE ARRAY[]::text[] END;
    ELSE RETURN false;
  END CASE;
  IF NOT p_reason = ANY(allowed_reasons) AND NOT (p_reason IS NULL AND array_position(allowed_reasons, NULL) IS NOT NULL) THEN RETURN false; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR octet_length(p_changes::text) > 4096 THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) AS k WHERE NOT (k = ANY(allowed_keys))) THEN RETURN false; END IF;
  FOR key, value IN SELECT * FROM jsonb_each(p_changes) LOOP
    IF key IN ('sourceSha256','mappingHash') THEN
      IF jsonb_typeof(value) <> 'string' OR value #>> '{}' !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
    ELSIF key IN ('runId','rowId','ownerStaffUserId','targetProductId','resultRevisionId') THEN
      IF value <> 'null'::jsonb AND (jsonb_typeof(value) <> 'string' OR value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RETURN false; END IF;
    ELSIF key IN ('sizeBytes','parsedRowCount','sourceParseIssueCount','mappingVersion','mappedFieldCount','version','invalidRowCount','warningRowCount','sheetIndex','sourceRowNumber','expectedRowVersion','expectedProductVersion') THEN
      IF jsonb_typeof(value) <> 'number' OR value #>> '{}' !~ '^(0|[1-9][0-9]*)$' OR (value #>> '{}')::numeric > 2147483647 THEN RETURN false; END IF;
    ELSIF key = 'sourceFormat' THEN
      IF value #>> '{}' NOT IN ('CSV','XLSX') THEN RETURN false; END IF;
    ELSIF key = 'state' THEN
      IF value #>> '{}' NOT IN ('SOURCE_READY','SOURCE_PARTIAL','MAPPED','PREVIEW_READY','PREVIEW_PARTIAL','COMPLETED','COMPLETED_WITH_ISSUES') THEN RETURN false; END IF;
    ELSIF key = 'parserVersion' THEN
      IF jsonb_typeof(value) <> 'string' OR length(value #>> '{}') > 32 THEN RETURN false; END IF;
    ELSIF key = 'action' THEN
      IF value #>> '{}' NOT IN ('ACCEPT_CREATE','ACCEPT_REVISION','REJECT','HOLD') THEN RETURN false; END IF;
    ELSIF key = 'outcome' THEN
      IF value #>> '{}' NOT IN ('APPLIED','REJECTED','HELD','CONFLICT') THEN RETURN false; END IF;
    ELSIF key = 'accessKind' THEN
      IF value #>> '{}' NOT IN ('READ','MUTATION') THEN RETURN false; END IF;
    ELSIF key NOT IN ('sourceSha256','mappingHash','runId','rowId','ownerStaffUserId','targetProductId','resultRevisionId','sizeBytes','parsedRowCount','sourceParseIssueCount','mappingVersion','mappedFieldCount','version','invalidRowCount','warningRowCount','sheetIndex','sourceRowNumber','expectedRowVersion','expectedProductVersion','sourceFormat','state','parserVersion','action','outcome','accessKind') THEN
      RETURN false;
    END IF;
  END LOOP;
  IF p_action = 'catalog.import.row.decided' AND p_outcome = 'DENIED'
     AND p_reason IN ('IMPORT_ROW_CONFLICT','IDENTITY_CONFLICT') THEN
    RETURN true;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE BEGIN ATOMIC
  SELECT CASE
    WHEN p_action LIKE 'catalog.import.%' THEN public.catalog_import_audit_event_valid(p_action,p_outcome,p_reason,p_changes)
    WHEN p_action LIKE 'catalog.%' THEN public.catalog_audit_event_valid(p_action,p_outcome,p_reason,p_changes)
    ELSE public.audit_event_valid_r1_002(p_action,p_outcome,p_reason,p_changes)
  END;
END;

ALTER TABLE audit_event DROP CONSTRAINT audit_event_entity_type_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_entity_type_check CHECK (
  entity_type IS NULL OR entity_type IN (
    'StaffUser','Role','StaffSession','SellerLegalEntity','FileObject','FileVersion','FileLink',
    'Brand','Category','AttributeDefinition','CatalogProduct','CatalogProductRevision',
    'ProductAttributeValue','ProductMedia','ProductDocumentVersion','ProductRelation',
    'CatalogImportRun','CatalogImportRow'
  )
);
ALTER TABLE audit_event DROP CONSTRAINT audit_event_catalog_entity_action_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_catalog_entity_action_check CHECK (
  action NOT LIKE 'catalog.%'
  OR (outcome <> 'SUCCESS' AND entity_type IS NULL AND entity_id IS NULL)
  OR COALESCE(CASE action
    WHEN 'catalog.reference.changed' THEN entity_type IN ('Brand','Category','AttributeDefinition')
    WHEN 'catalog.product.created' THEN entity_type = 'CatalogProduct'
    WHEN 'catalog.product.revision.created' THEN entity_type IN ('CatalogProduct','CatalogProductRevision')
    WHEN 'catalog.product.submitted' THEN entity_type IN ('CatalogProduct','CatalogProductRevision')
    WHEN 'catalog.product.reviewed' THEN entity_type IN ('CatalogProduct','CatalogProductRevision')
    WHEN 'catalog.product.archived' THEN entity_type = 'CatalogProduct'
    WHEN 'catalog.product.relations.changed' THEN entity_type IN ('CatalogProductRevision','ProductRelation')
    WHEN 'catalog.product.media.changed' THEN entity_type IN ('CatalogProductRevision','ProductMedia')
    WHEN 'catalog.product.documents.changed' THEN entity_type IN ('CatalogProductRevision','ProductDocumentVersion')
    WHEN 'catalog.permissions.initialized' THEN entity_type IS NULL OR entity_type = 'Role'
    WHEN 'catalog.import.created' THEN entity_type = 'CatalogImportRun'
    WHEN 'catalog.import.mapping.changed' THEN entity_type = 'CatalogImportRun'
    WHEN 'catalog.import.preview.completed' THEN entity_type = 'CatalogImportRun'
    WHEN 'catalog.import.row.decided' THEN entity_type = 'CatalogImportRow'
    WHEN 'catalog.import.cross_owner.accessed' THEN entity_type IN ('CatalogImportRun','CatalogImportRow')
    ELSE false
  END, false)
);

GRANT SELECT, INSERT, UPDATE ON catalog_import_run, catalog_import_row TO stdu_runtime;
GRANT SELECT, INSERT ON catalog_import_decision TO stdu_runtime;
GRANT INSERT ON file_object, file_version TO stdu_runtime;

COMMIT;
