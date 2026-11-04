-- SEC-API-02 test profile, derived from the Stage B job and lease SQL at 5c4b6f4.
BEGIN;
DO $$
BEGIN
  IF current_database() <> 'stdu_sec_api_02_test' OR
     current_setting('stdu.sec_api_02_mock', true) IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'SEC_API_02_DISPOSABLE_DATABASE_REQUIRED';
  END IF;
END;
$$;

DO $$
BEGIN
  -- The names are reserved for this additive migration. Reusing an existing
  -- role could inherit unknown ACLs or object ownership into scanner authority.
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname IN (
      'stdu_scan_migration_owner','stdu_scan_worker','stdu_scan_operator'
    )
  ) THEN
    RAISE EXCEPTION 'R1-010D reserved scanner role names must be absent before migration';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stdu_scan_migration_owner') THEN
    CREATE ROLE stdu_scan_migration_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'stdu_scan_migration_owner'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'stdu_scan_migration_owner exists with unsafe attributes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stdu_scan_worker') THEN
    CREATE ROLE stdu_scan_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'stdu_scan_worker'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'stdu_scan_worker exists with unsafe attributes';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stdu_scan_operator') THEN
    CREATE ROLE stdu_scan_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'stdu_scan_operator'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'stdu_scan_operator exists with unsafe attributes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE granted_role.rolname IN (
      'stdu_scan_migration_owner','stdu_scan_worker','stdu_scan_operator'
    ) OR member_role.rolname IN (
      'stdu_scan_migration_owner','stdu_scan_worker','stdu_scan_operator'
    )
  ) THEN
    RAISE EXCEPTION 'R1-010D roles must not have pre-existing role memberships';
  END IF;
END;
$$;

CREATE TABLE inquiry_source_document_scan_job (
  id uuid PRIMARY KEY,
  source_document_id uuid NOT NULL UNIQUE,
  source_storage_key varchar(128) NOT NULL,
  source_sha256 bytea NOT NULL,
  source_size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  available_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  lease_token_hash bytea,
  lease_expires_at timestamptz(6),
  failure_code text,
  provider_outcome text CHECK (provider_outcome IN (
    'INFECTED','SCAN_ERROR','SCAN_INDETERMINATE','CLEAN_VERIFIED','PROVIDER_BLOCKED'
  )),
  last_attempt_at timestamptz(6),
  last_scan_duration_ms integer,
  completed_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT inquiry_scan_job_source_fk FOREIGN KEY (source_document_id)
    REFERENCES inquiry_source_document(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT inquiry_scan_job_storage_key_check CHECK (source_storage_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT inquiry_scan_job_sha256_check CHECK (octet_length(source_sha256) = 32),
  CONSTRAINT inquiry_scan_job_size_check CHECK (source_size_bytes BETWEEN 1 AND 52428800),
  CONSTRAINT inquiry_scan_job_status_check CHECK (status IN ('PENDING','LEASED','RETRY_WAIT','COMPLETE','STOPPED')),
  CONSTRAINT inquiry_scan_job_attempt_check CHECK (attempt_count BETWEEN 0 AND 5),
  CONSTRAINT inquiry_scan_job_version_check CHECK (version > 0),
  CONSTRAINT inquiry_scan_job_lease_check CHECK (
    ((lease_token_hash IS NULL) = (lease_expires_at IS NULL))
    AND ((status = 'LEASED') = (lease_token_hash IS NOT NULL))
    AND (lease_token_hash IS NULL OR octet_length(lease_token_hash) = 32)
  ),
  CONSTRAINT inquiry_scan_job_failure_check CHECK (failure_code IS NULL OR failure_code IN (
    'SCANNER_UNAVAILABLE','SCAN_TIMEOUT','STREAM_INTERRUPTED','PROTOCOL_ERROR',
    'SIGNATURES_STALE','SIGNATURES_CHANGED','SOURCE_MISMATCH','SCAN_LIMIT_EXCEEDED',
    'ENCRYPTED_OR_UNSCANNABLE','INTERNAL_ERROR'
  )),
  CONSTRAINT inquiry_scan_job_duration_check CHECK (last_scan_duration_ms IS NULL OR last_scan_duration_ms BETWEEN 0 AND 180000),
  CONSTRAINT inquiry_scan_job_completion_check CHECK ((status IN ('COMPLETE','STOPPED')) = (completed_at IS NOT NULL))
);
CREATE INDEX inquiry_scan_job_queue_idx
  ON inquiry_source_document_scan_job(status, available_at, created_at, id);
CREATE INDEX inquiry_scan_job_lease_expiry_idx
  ON inquiry_source_document_scan_job(status, lease_expires_at, id);
CREATE UNIQUE INDEX inquiry_scan_job_active_lease_hash_key
  ON inquiry_source_document_scan_job(lease_token_hash) WHERE lease_token_hash IS NOT NULL;

-- Existing quarantined originals are preserved verbatim; terminal documents are not queued.
INSERT INTO inquiry_source_document_scan_job (
  id, source_document_id, source_storage_key, source_sha256, source_size_bytes,
  status, attempt_count, version, available_at, created_at, updated_at
)
SELECT gen_random_uuid(), id, storage_key, sha256, size_bytes,
       'PENDING', 0, 1, transaction_timestamp(), transaction_timestamp(), transaction_timestamp()
FROM inquiry_source_document
WHERE safety_state = 'QUARANTINED'
ON CONFLICT (source_document_id) DO NOTHING;

-- Preserve earlier audit validation and add only the allowlisted scan control action.
ALTER FUNCTION inquiry_audit_event_valid(text,text,text,jsonb)
  RENAME TO inquiry_audit_event_valid_pre_r1_010d;

CREATE FUNCTION inquiry_audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_keys text[] := ARRAY['version'];
  v_key text;
  v_value jsonb;
BEGIN
  IF p_action <> 'inquiry.document.scan_job_control_changed' THEN
    RETURN public.inquiry_audit_event_valid_pre_r1_010d(p_action,p_outcome,p_reason,p_changes);
  END IF;
  IF p_outcome <> 'SUCCESS' OR p_reason NOT IN (
    'SCAN_ATTEMPT_CLAIMED','SCAN_RETRY_SCHEDULED','SCAN_ATTEMPTS_EXHAUSTED','SCAN_OPERATOR_RETRY'
  ) THEN RETURN false; END IF;
  IF p_reason = 'SCAN_OPERATOR_RETRY' THEN v_keys := ARRAY['correlationId','version']; END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_changes)) <> cardinality(v_keys)
     OR EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE NOT (p_changes ? k)) THEN RETURN false; END IF;
  FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_changes) LOOP
    IF v_key = 'version' THEN
      IF jsonb_typeof(v_value) <> 'number' OR v_value #>> '{}' !~ '^[1-9][0-9]*$'
         OR (v_value #>> '{}')::numeric > 2147483647 THEN RETURN false; END IF;
    ELSIF v_key = 'correlationId' THEN
      IF jsonb_typeof(v_value) <> 'string'
         OR v_value #>> '{}' !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$' THEN RETURN false; END IF;
    ELSE RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
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
    'InquirySourceDocument','InquiryUploadIntent','InquirySourceDocumentScanJob'
  )
);
ALTER TABLE audit_event DROP CONSTRAINT audit_event_inquiry_actor_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_inquiry_actor_check CHECK (
  (action NOT LIKE 'inquiry.%')
  OR (action IN ('inquiry.created','inquiry.upload_intent.created','inquiry.upload.completed','inquiry.upload.rejected','inquiry.upload.cancelled') AND actor_kind = 'ANONYMOUS')
  OR (action IN ('inquiry.document.scan_state_changed','inquiry.document.scan_job_control_changed') AND actor_kind = 'OPERATOR')
  OR (action NOT IN ('inquiry.created','inquiry.upload_intent.created','inquiry.upload.completed','inquiry.upload.rejected','inquiry.upload.cancelled','inquiry.document.scan_state_changed','inquiry.document.scan_job_control_changed') AND actor_kind = 'STAFF')
);
ALTER TABLE audit_event DROP CONSTRAINT audit_event_inquiry_entity_action_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_inquiry_entity_action_check CHECK (
  (action NOT LIKE 'inquiry.%')
  OR (action IN ('inquiry.created','inquiry.manager.assigned','inquiry.engineer.assigned','inquiry.transitioned','inquiry.closed_without_quote','inquiry.stage_deadline.changed') AND entity_type = 'Inquiry')
  OR (action = 'inquiry.comment.created' AND entity_type = 'InquiryComment')
  OR (action IN ('inquiry.upload_intent.created','inquiry.upload.rejected','inquiry.upload.cancelled') AND entity_type = 'InquiryUploadIntent')
  OR (action IN ('inquiry.upload.completed','inquiry.document.downloaded','inquiry.document.scan_state_changed') AND entity_type = 'InquirySourceDocument')
  OR (action = 'inquiry.document.scan_job_control_changed' AND entity_type = 'InquirySourceDocumentScanJob')
);

CREATE FUNCTION inquiry_scan_job_insert_after_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.safety_state <> 'QUARANTINED' THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_SOURCE_INITIAL_STATE_INVALID' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.inquiry_source_document_scan_job (
    id,source_document_id,source_storage_key,source_sha256,source_size_bytes
  ) VALUES (gen_random_uuid(),NEW.id,NEW.storage_key,NEW.sha256,NEW.size_bytes);
  RETURN NEW;
END;
$$;
CREATE TRIGGER inquiry_scan_job_after_source_insert
  AFTER INSERT ON inquiry_source_document FOR EACH ROW EXECUTE FUNCTION inquiry_scan_job_insert_after_source();

CREATE FUNCTION inquiry_scan_claim(p_lease_token_hash bytea, p_request_id uuid)
RETURNS TABLE(job_id uuid,source_document_id uuid,expected_sha256 bytea,expected_size_bytes bigint,
              profile_limit_bytes bigint,job_version integer,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_job public.inquiry_source_document_scan_job%ROWTYPE;
  v_source public.inquiry_source_document%ROWTYPE;
  v_profile text;
  v_limit bigint;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT pg_has_role(session_user,'stdu_scan_worker','MEMBER') THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_WORKER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_lease_token_hash IS NULL OR octet_length(p_lease_token_hash) <> 32 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_CLAIM_ARGUMENT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT pg_try_advisory_xact_lock(48201002) THEN RETURN; END IF;
  SELECT j.* INTO v_job
  FROM public.inquiry_source_document_scan_job j
  WHERE j.status = 'LEASED' AND j.lease_expires_at <= v_now
  ORDER BY j.lease_expires_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF FOUND THEN
    SELECT s.* INTO v_source FROM public.inquiry_source_document s WHERE s.id=v_job.source_document_id FOR UPDATE;
    v_now := clock_timestamp();
    IF v_job.status<>'LEASED' OR v_job.lease_expires_at>v_now THEN
      RETURN;
    END IF;
    UPDATE public.inquiry_source_document_scan_job
      SET status='STOPPED',version=version+1,lease_token_hash=NULL,lease_expires_at=NULL,
          failure_code='SCANNER_UNAVAILABLE',completed_at=v_now,updated_at=v_now
      WHERE id=v_job.id RETURNING * INTO v_job;
    IF FOUND AND v_source.safety_state='QUARANTINED' THEN
      UPDATE public.inquiry_source_document SET safety_state='SCAN_ERROR' WHERE id=v_source.id;
      INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
      VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_state_changed',
        'InquirySourceDocument',v_source.id,'FAILURE','SCANNER_UNAVAILABLE',p_request_id,
        jsonb_build_object('previousState','QUARANTINED','state','SCAN_ERROR','version',v_job.version));
    END IF;
    INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
    VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_job_control_changed',
      'InquirySourceDocumentScanJob',v_job.id,'SUCCESS','SCAN_ATTEMPTS_EXHAUSTED',p_request_id,
      jsonb_build_object('version',v_job.version));
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.inquiry_source_document_scan_job WHERE status='LEASED' OR provider_outcome='PROVIDER_BLOCKED')
     OR (SELECT COALESCE(sum(attempt_count),0) FROM public.inquiry_source_document_scan_job) >= 20 THEN
    RETURN;
  END IF;
  SELECT j.* INTO v_job
  FROM public.inquiry_source_document_scan_job j
  WHERE j.status='PENDING' AND j.attempt_count=0 AND j.available_at<=v_now
  ORDER BY j.available_at,j.created_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT s.* INTO v_source FROM public.inquiry_source_document s WHERE s.id=v_job.source_document_id FOR UPDATE;
  v_now := clock_timestamp();
  IF NOT ((v_job.status='PENDING' AND v_job.available_at<=v_now)
       OR (v_job.status='RETRY_WAIT' AND v_job.available_at<=v_now)
       OR (v_job.status='LEASED' AND v_job.lease_expires_at<=v_now)) THEN
    RETURN;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_SOURCE_MISSING' USING ERRCODE = '40001';
  END IF;
  IF v_source.storage_key IS DISTINCT FROM v_job.source_storage_key
     OR v_source.sha256 IS DISTINCT FROM v_job.source_sha256
     OR v_source.size_bytes IS DISTINCT FROM v_job.source_size_bytes
     OR v_source.safety_state NOT IN ('QUARANTINED','SCAN_ERROR') THEN
    UPDATE public.inquiry_source_document_scan_job
      SET status='STOPPED',version=version+1,lease_token_hash=NULL,lease_expires_at=NULL,
          failure_code='SOURCE_MISMATCH',completed_at=v_now,updated_at=v_now
      WHERE id=v_job.id RETURNING * INTO v_job;
    IF v_source.id IS NOT NULL AND v_source.safety_state='QUARANTINED' THEN
      UPDATE public.inquiry_source_document SET safety_state='SCAN_ERROR' WHERE id=v_source.id;
      INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
      VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_state_changed',
        'InquirySourceDocument',v_source.id,'FAILURE','INTERNAL_ERROR',p_request_id,
        jsonb_build_object('previousState','QUARANTINED','state','SCAN_ERROR','version',v_job.version));
    END IF;
    RETURN;
  END IF;
  SELECT i.upload_profile_code INTO v_profile FROM public.inquiry i WHERE i.id=v_source.inquiry_id;
  v_limit := CASE v_profile WHEN 'MVP_SAFE' THEN 10485760 WHEN 'ENGINEERING_DOCUMENTS' THEN 52428800 ELSE NULL END;
  IF v_limit IS NULL OR v_source.size_bytes > v_limit THEN
    UPDATE public.inquiry_source_document_scan_job
      SET status='STOPPED',version=version+1,lease_token_hash=NULL,lease_expires_at=NULL,
          failure_code='SOURCE_MISMATCH',completed_at=v_now,updated_at=v_now
      WHERE id=v_job.id RETURNING * INTO v_job;
    IF v_source.safety_state='QUARANTINED' THEN
      UPDATE public.inquiry_source_document SET safety_state='SCAN_ERROR' WHERE id=v_source.id;
      INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
      VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_state_changed',
        'InquirySourceDocument',v_source.id,'FAILURE','INTERNAL_ERROR',p_request_id,
        jsonb_build_object('previousState','QUARANTINED','state','SCAN_ERROR','version',v_job.version));
    END IF;
    RETURN;
  END IF;
  UPDATE public.inquiry_source_document_scan_job
    SET status='LEASED',attempt_count=attempt_count+1,version=version+1,
        lease_token_hash=p_lease_token_hash,lease_expires_at=v_now+interval '240 seconds',
        failure_code=NULL,completed_at=NULL,last_attempt_at=v_now,updated_at=v_now
    WHERE id=v_job.id RETURNING * INTO v_job;
  INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
  VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_job_control_changed',
    'InquirySourceDocumentScanJob',v_job.id,'SUCCESS','SCAN_ATTEMPT_CLAIMED',p_request_id,
    jsonb_build_object('version',v_job.version));
  RETURN QUERY SELECT v_job.id,v_source.id,v_source.sha256,v_source.size_bytes,v_limit,v_job.version,v_job.lease_expires_at;
END;
$$;

CREATE FUNCTION inquiry_scan_read_authorized(p_job_id uuid,p_job_version integer,p_lease_token_hash bytea)
RETURNS TABLE(source_document_id uuid,source_storage_key text,source_sha256 bytea,source_size_bytes bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF session_user <> 'stdu_runtime' THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_API_RUNTIME_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_job_id IS NULL OR p_job_version IS NULL OR p_lease_token_hash IS NULL OR octet_length(p_lease_token_hash) <> 32 THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_READ_ARGUMENT_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT s.id,s.storage_key::text,s.sha256,s.size_bytes
  FROM public.inquiry_source_document_scan_job j
  JOIN public.inquiry_source_document s ON s.id=j.source_document_id
  WHERE j.id=p_job_id AND j.version=p_job_version AND j.status='LEASED'
    AND j.lease_token_hash=p_lease_token_hash AND j.lease_expires_at>clock_timestamp()
    AND j.source_storage_key=s.storage_key AND j.source_sha256=s.sha256 AND j.source_size_bytes=s.size_bytes
    AND s.safety_state IN ('QUARANTINED','SCAN_ERROR');
  IF NOT FOUND THEN RAISE EXCEPTION 'INQUIRY_SCAN_LEASE_INVALID' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE FUNCTION inquiry_scan_finalize(
  p_job_id uuid, p_version integer, p_token_hash bytea, p_outcome text,
  p_sha256 bytea, p_size bigint, p_request_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  j public.inquiry_source_document_scan_job%ROWTYPE;
  d public.inquiry_source_document%ROWTYPE;
  next_state text;
BEGIN
  IF NOT pg_has_role(session_user,'stdu_scan_worker','MEMBER') OR
     p_outcome IS NULL OR p_outcome NOT IN ('INFECTED','SCAN_ERROR','SCAN_INDETERMINATE','CLEAN_VERIFIED','PROVIDER_BLOCKED') OR
     p_request_id IS NULL THEN RAISE EXCEPTION 'INQUIRY_SCAN_FINALIZE_ARGUMENT_INVALID'; END IF;
  SELECT * INTO STRICT j FROM public.inquiry_source_document_scan_job WHERE id=p_job_id FOR UPDATE;
  SELECT * INTO STRICT d FROM public.inquiry_source_document WHERE id=j.source_document_id FOR UPDATE;
  IF j.status <> 'LEASED' OR j.version IS DISTINCT FROM p_version OR
     j.lease_token_hash IS DISTINCT FROM p_token_hash OR j.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_FENCING_CONFLICT';
  END IF;
  IF d.storage_key IS DISTINCT FROM j.source_storage_key OR d.sha256 IS DISTINCT FROM j.source_sha256 OR
     d.size_bytes IS DISTINCT FROM j.source_size_bytes OR d.safety_state <> 'QUARANTINED' OR
     (p_outcome IN ('INFECTED','CLEAN_VERIFIED') AND
       (p_sha256 IS DISTINCT FROM j.source_sha256 OR p_size IS DISTINCT FROM j.source_size_bytes)) THEN
    RAISE EXCEPTION 'INQUIRY_SCAN_SOURCE_MISMATCH';
  END IF;
  next_state := CASE p_outcome WHEN 'INFECTED' THEN 'REJECTED' ELSE 'SCAN_ERROR' END;
  UPDATE public.inquiry_source_document SET safety_state=next_state WHERE id=d.id;
  UPDATE public.inquiry_source_document_scan_job
    SET status=CASE WHEN next_state='REJECTED' THEN 'COMPLETE' ELSE 'STOPPED' END,
        version=version+1, lease_token_hash=NULL, lease_expires_at=NULL, provider_outcome=p_outcome,
        failure_code=CASE WHEN next_state='REJECTED' THEN NULL WHEN p_outcome='SCAN_INDETERMINATE' THEN 'ENCRYPTED_OR_UNSCANNABLE' ELSE 'INTERNAL_ERROR' END,
        completed_at=clock_timestamp(), updated_at=clock_timestamp()
    WHERE id=j.id;
  INSERT INTO public.audit_event(id,actor_kind,operator_label,action,entity_type,entity_id,outcome,reason_code,request_id,changes)
    VALUES(gen_random_uuid(),'OPERATOR','inquiry-scanner-worker','inquiry.document.scan_state_changed',
      'InquirySourceDocument',d.id,
      CASE WHEN next_state='REJECTED' THEN 'SUCCESS' ELSE 'FAILURE' END,
      CASE WHEN next_state='REJECTED' THEN 'SCAN_REJECTED' ELSE 'INTERNAL_ERROR' END,
      p_request_id,jsonb_build_object('previousState',d.safety_state,'state',next_state,'version',j.version+1));
END;
$$;

-- A non-login owner holds only the rights required by the four definer functions and insert trigger.
GRANT USAGE ON SCHEMA public TO stdu_scan_migration_owner;
GRANT SELECT ON inquiry TO stdu_scan_migration_owner;
GRANT SELECT ON inquiry_source_document TO stdu_scan_migration_owner;
GRANT UPDATE (safety_state) ON inquiry_source_document TO stdu_scan_migration_owner;
GRANT SELECT,INSERT,UPDATE ON inquiry_source_document_scan_job TO stdu_scan_migration_owner;
GRANT INSERT ON audit_event TO stdu_scan_migration_owner;
ALTER FUNCTION inquiry_scan_job_insert_after_source() OWNER TO stdu_scan_migration_owner;
ALTER FUNCTION inquiry_scan_claim(bytea,uuid) OWNER TO stdu_scan_migration_owner;
ALTER FUNCTION inquiry_scan_read_authorized(uuid,integer,bytea) OWNER TO stdu_scan_migration_owner;
ALTER FUNCTION inquiry_scan_finalize(uuid,integer,bytea,text,bytea,bigint,uuid) OWNER TO stdu_scan_migration_owner;

REVOKE ALL ON inquiry_source_document_scan_job FROM PUBLIC,stdu_runtime,stdu_scan_worker,stdu_scan_operator;
REVOKE UPDATE ON inquiry_source_document FROM PUBLIC,stdu_runtime,stdu_scan_worker,stdu_scan_operator;
REVOKE UPDATE (safety_state) ON inquiry_source_document FROM PUBLIC,stdu_runtime,stdu_scan_worker,stdu_scan_operator;
REVOKE ALL ON FUNCTION inquiry_scan_job_insert_after_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION inquiry_scan_claim(bytea,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION inquiry_scan_read_authorized(uuid,integer,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION inquiry_scan_finalize(uuid,integer,bytea,text,bytea,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION inquiry_scan_claim(bytea,uuid) TO stdu_scan_worker;
GRANT EXECUTE ON FUNCTION inquiry_scan_finalize(uuid,integer,bytea,text,bytea,bigint,uuid) TO stdu_scan_worker;
GRANT EXECUTE ON FUNCTION inquiry_scan_read_authorized(uuid,integer,bytea) TO stdu_runtime;

COMMIT;
