-- FROZEN R1-002 1.0.0 initial staff identity schema.
-- This migration is intentionally explicit and transactional. Apply only with the
-- migration owner; the application uses the separately provisioned stdu_runtime role.
BEGIN;

CREATE FUNCTION audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_reasons text[];
  v_keys text[];
  v_null_reason boolean := false;
  v_allowed_permissions text[] := ARRAY[
    'staff.users.read','staff.users.create','staff.users.status.write',
    'staff.sessions.revoke','staff.roles.read','staff.roles.write',
    'staff.roles.permissions.write','staff.roles.assign','sellers.read',
    'sellers.write','audit.read','files.metadata.read'
  ];
  v_key text;
  v_value jsonb;
BEGIN
  CASE p_action
    WHEN 'auth.login' THEN
      v_keys := ARRAY['accountFingerprint'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['CREDENTIALS_VERIFIED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['INVALID_CREDENTIALS','RATE_LIMITED','CSRF_INVALID','ORIGIN_FORBIDDEN','VALIDATION_ERROR','ALREADY_AUTHENTICATED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'auth.logout' THEN
      v_keys := ARRAY[]::text[];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['LOGOUT'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['AUTH_REQUIRED','CSRF_INVALID','ORIGIN_FORBIDDEN','VALIDATION_ERROR','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.sessions.revoked' THEN
      v_keys := ARRAY['targetUserId','count'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['LOGOUT','ADMIN_REVOKE','SESSION_LIMIT','USER_BLOCKED','USER_UNBLOCKED','ROLE_ASSIGNED','ROLE_REMOVED','ROLE_PERMISSIONS_CHANGED','PASSWORD_CHANGED','ACCESS_RECOVERED','SESSION_ABSOLUTE_EXPIRED','SESSION_IDLE_EXPIRED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'auth.session.rotated' THEN
      v_keys := ARRAY['targetUserId'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['PASSWORD_CHANGED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'auth.session.expired' THEN
      v_keys := ARRAY[]::text[];
      CASE p_outcome
        WHEN 'DENIED' THEN v_reasons := ARRAY['SESSION_ABSOLUTE_EXPIRED','SESSION_IDLE_EXPIRED'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.bootstrap' THEN
      v_keys := ARRAY['targetUserId','passwordChangeRequired'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['BOOTSTRAP'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['BOOTSTRAP_ALREADY_COMPLETED','VALIDATION_ERROR'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.access.recovered' THEN
      v_keys := ARRAY['targetUserId','passwordChangeRequired','recoveryMode'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['OWNER_CONFIRMED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['LAST_ADMIN_REQUIRED','INVALID_STATE_TRANSITION','NOT_FOUND','VALIDATION_ERROR'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.password.changed' THEN
      v_keys := ARRAY['targetUserId','passwordChangeRequired'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['PASSWORD_CHANGED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['CURRENT_PASSWORD_INVALID','RATE_LIMITED','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','VALIDATION_ERROR','UNSUPPORTED_MEDIA_TYPE','LAST_ADMIN_REQUIRED'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.password.rehashed' THEN
      v_keys := ARRAY['targetUserId'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['HASH_UPGRADED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.user.created' THEN
      v_keys := ARRAY['targetUserId','changedFields'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.user.state.changed' THEN
      v_keys := ARRAY['targetUserId','previousState','state','changedFields'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['USER_BLOCKED','USER_UNBLOCKED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.role.created' THEN
      v_keys := ARRAY['roleId','changedFields'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.role.changed' THEN
      v_keys := ARRAY['roleId','previousState','state','changedFields'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.role.assigned' THEN
      v_keys := ARRAY['targetUserId','roleId'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['ROLE_ASSIGNED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.role.removed' THEN
      v_keys := ARRAY['targetUserId','roleId'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['ROLE_REMOVED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'staff.role.permissions.changed' THEN
      v_keys := ARRAY['roleId','addedPermissions','removedPermissions','affectedUserCount'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_reasons := ARRAY['ROLE_PERMISSIONS_CHANGED'];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'seller.created' THEN
      v_keys := ARRAY['sellerId','changedFields'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'seller.changed' THEN
      v_keys := ARRAY['sellerId','changedFields','previousState','state'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN','AUTH_REQUIRED','UNSUPPORTED_MEDIA_TYPE'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'file.metadata.changed' THEN
      v_keys := ARRAY['changedFields','version'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'file.version.created' THEN
      v_keys := ARRAY['changedFields','version'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    WHEN 'file.link.changed' THEN
      v_keys := ARRAY['changedFields','version'];
      CASE p_outcome
        WHEN 'SUCCESS' THEN v_null_reason := true; v_reasons := ARRAY[]::text[];
        WHEN 'DENIED' THEN v_reasons := ARRAY['FORBIDDEN','PASSWORD_CHANGE_REQUIRED','SELF_PRIVILEGE_CHANGE_FORBIDDEN','GRANT_CEILING_EXCEEDED','LAST_ADMIN_REQUIRED','ROLE_IN_USE','VERSION_CONFLICT','INVALID_STATE_TRANSITION','VALIDATION_ERROR','NOT_FOUND','EMAIL_IN_USE','CSRF_INVALID','ORIGIN_FORBIDDEN'];
        WHEN 'FAILURE' THEN v_reasons := ARRAY['DEPENDENCY_UNAVAILABLE','INTERNAL_ERROR'];
        ELSE RETURN false;
      END CASE;
    ELSE RETURN false;
  END CASE;

  IF p_reason IS NULL THEN
    IF NOT v_null_reason THEN RETURN false; END IF;
  ELSIF NOT (p_reason = ANY(v_reasons)) THEN
    RETURN false;
  END IF;

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) AS keys(key) WHERE NOT (key = ANY(v_keys))) THEN RETURN false; END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_changes) LOOP
    CASE v_key
      WHEN 'targetUserId' THEN IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
      WHEN 'roleId' THEN IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
      WHEN 'sellerId' THEN IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
      WHEN 'count' THEN IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
      WHEN 'affectedUserCount' THEN IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
      WHEN 'version' THEN IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^[1-9][0-9]*$' THEN RETURN false; END IF;
      WHEN 'passwordChangeRequired' THEN IF jsonb_typeof(v_value) <> 'boolean' THEN RETURN false; END IF;
      WHEN 'recoveryMode' THEN IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' NOT IN ('NORMAL','LAST_ADMIN_OWNER') THEN RETURN false; END IF;
      WHEN 'previousState' THEN IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' NOT IN ('ACTIVE','BLOCKED','DRAFT','ARCHIVED') THEN RETURN false; END IF;
      WHEN 'state' THEN IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' NOT IN ('ACTIVE','BLOCKED','DRAFT','ARCHIVED') THEN RETURN false; END IF;
      WHEN 'accountFingerprint' THEN IF jsonb_typeof(v_value) <> 'string' OR v_value #>> '{}' !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
      WHEN 'changedFields' THEN
        IF jsonb_typeof(v_value) <> 'array' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_value) AS fields(item)
          WHERE jsonb_typeof(item) <> 'string' OR item #>> '{}' NOT IN (
            'displayName','state','name','code','permissions','roles','passwordChangeRequired',
            'legalName','kind','inn','kpp','ogrn','legalAddress','archivedAt','visibility','version'
          )
        ) THEN RETURN false; END IF;
      WHEN 'addedPermissions' THEN
        IF jsonb_typeof(v_value) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_value) AS added(permission_code) WHERE permission_code <> ALL(v_allowed_permissions)) THEN RETURN false; END IF;
      WHEN 'removedPermissions' THEN
        IF jsonb_typeof(v_value) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_value) AS removed(permission_code) WHERE permission_code <> ALL(v_allowed_permissions)) THEN RETURN false; END IF;
      ELSE RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
END;
$$;

CREATE TABLE staff_user (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL,
  email_normalized varchar(254) COLLATE "C" NOT NULL,
  display_name varchar(120) NOT NULL,
  password_hash text NOT NULL,
  password_change_required boolean NOT NULL DEFAULT false,
  state text NOT NULL,
  auth_version integer NOT NULL DEFAULT 1,
  blocked_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT staff_user_email_normalized_key UNIQUE (email_normalized),
  CONSTRAINT staff_user_email_format_check CHECK (
    email = btrim(email) AND email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
  ),
  CONSTRAINT staff_user_email_normalized_check CHECK (email_normalized = lower(email COLLATE "C")),
  CONSTRAINT staff_user_password_hash_check CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT staff_user_state_check CHECK (state IN ('ACTIVE','BLOCKED')),
  CONSTRAINT staff_user_auth_version_check CHECK (auth_version > 0),
  CONSTRAINT staff_user_blocked_at_check CHECK ((state = 'BLOCKED') = (blocked_at IS NOT NULL)),
  CONSTRAINT staff_user_version_check CHECK (version > 0),
  CONSTRAINT staff_user_display_name_check CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 120)
);
CREATE INDEX staff_user_state_id_idx ON staff_user(state,id);

CREATE TABLE role (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  state text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT role_code_check CHECK (code ~ '^[a-z][a-z0-9.-]{1,63}$'),
  CONSTRAINT role_name_check CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 120),
  CONSTRAINT role_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT role_version_check CHECK (version > 0)
);
CREATE INDEX role_state_id_idx ON role(state,id);

CREATE TABLE permission (
  id uuid PRIMARY KEY,
  code varchar(80) NOT NULL UNIQUE,
  description varchar(240) NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT permission_code_check CHECK (code ~ '^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$')
);

CREATE TABLE user_role (
  staff_user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  assigned_by_user_id uuid,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT user_role_pkey PRIMARY KEY (staff_user_id,role_id),
  CONSTRAINT user_role_staff_user_fk FOREIGN KEY (staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_role_role_fk FOREIGN KEY (role_id) REFERENCES role(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_role_assigned_by_fk FOREIGN KEY (assigned_by_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX user_role_role_user_idx ON user_role(role_id,staff_user_id);

CREATE TABLE role_permission (
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT role_permission_pkey PRIMARY KEY (role_id,permission_id),
  CONSTRAINT role_permission_role_fk FOREIGN KEY (role_id) REFERENCES role(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_permission_permission_fk FOREIGN KEY (permission_id) REFERENCES permission(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX role_permission_permission_role_idx ON role_permission(permission_id,role_id);

CREATE TABLE staff_session (
  id uuid PRIMARY KEY,
  staff_user_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  auth_version integer NOT NULL,
  absolute_expires_at timestamptz(6) NOT NULL,
  idle_timeout_seconds integer NOT NULL DEFAULT 1800,
  last_seen_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  revocation_reason varchar(64),
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT staff_session_user_fk FOREIGN KEY (staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT staff_session_token_hash_check CHECK (octet_length(token_hash) = 32),
  CONSTRAINT staff_session_auth_version_check CHECK (auth_version > 0),
  CONSTRAINT staff_session_idle_timeout_check CHECK (idle_timeout_seconds BETWEEN 60 AND 43200),
  CONSTRAINT staff_session_order_check CHECK (created_at <= last_seen_at AND last_seen_at < absolute_expires_at AND absolute_expires_at > created_at),
  CONSTRAINT staff_session_revocation_pair_check CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CONSTRAINT staff_session_revocation_time_check CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT staff_session_revocation_reason_check CHECK (revocation_reason IS NULL OR revocation_reason IN ('LOGOUT','ADMIN_REVOKE','SESSION_LIMIT','USER_BLOCKED','USER_UNBLOCKED','ROLE_ASSIGNED','ROLE_REMOVED','ROLE_PERMISSIONS_CHANGED','PASSWORD_CHANGED','ACCESS_RECOVERED','SESSION_ABSOLUTE_EXPIRED','SESSION_IDLE_EXPIRED'))
);
CREATE INDEX staff_session_user_revoked_idx ON staff_session(staff_user_id,revoked_at);
CREATE INDEX staff_session_absolute_expiry_idx ON staff_session(absolute_expires_at);

CREATE TABLE seller_legal_entity (
  id uuid PRIMARY KEY,
  display_name varchar(160) NOT NULL,
  legal_name varchar(500),
  kind text NOT NULL,
  inn varchar(12),
  kpp varchar(9),
  ogrn varchar(15),
  legal_address varchar(1000),
  state text NOT NULL,
  archived_at timestamptz(6),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT seller_kind_check CHECK (kind IN ('OOO','IP')),
  CONSTRAINT seller_inn_check CHECK (inn IS NULL OR (inn ~ '^[0-9]+$' AND ((kind = 'OOO' AND length(inn) = 10) OR (kind = 'IP' AND length(inn) = 12)))),
  CONSTRAINT seller_kpp_check CHECK (kpp IS NULL OR (kind = 'OOO' AND kpp ~ '^[0-9]{9}$')),
  CONSTRAINT seller_ogrn_check CHECK (ogrn IS NULL OR ((kind = 'OOO' AND ogrn ~ '^[0-9]{13}$') OR (kind = 'IP' AND ogrn ~ '^[0-9]{15}$'))),
  CONSTRAINT seller_state_check CHECK (state IN ('DRAFT','ACTIVE','ARCHIVED')),
  CONSTRAINT seller_active_fields_check CHECK (state <> 'ACTIVE' OR (legal_name IS NOT NULL AND btrim(legal_name) <> '' AND inn IS NOT NULL)),
  CONSTRAINT seller_archive_time_check CHECK ((state = 'ARCHIVED') = (archived_at IS NOT NULL)),
  CONSTRAINT seller_version_check CHECK (version > 0),
  CONSTRAINT seller_display_name_check CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 160)
);
CREATE UNIQUE INDEX seller_legal_entity_inn_unique_idx ON seller_legal_entity(inn) WHERE inn IS NOT NULL;
CREATE INDEX seller_legal_entity_state_id_idx ON seller_legal_entity(state,id);

CREATE TABLE audit_event (
  id uuid PRIMARY KEY,
  occurred_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  actor_kind text NOT NULL,
  actor_user_id uuid,
  operator_label varchar(80),
  action varchar(80) NOT NULL,
  entity_type text,
  entity_id uuid,
  outcome text NOT NULL,
  reason_code varchar(64),
  request_id uuid NOT NULL,
  source_hash bytea,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_event_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT audit_event_actor_kind_check CHECK (actor_kind IN ('STAFF','ANONYMOUS','OPERATOR')),
  CONSTRAINT audit_event_actor_pair_check CHECK ((actor_kind = 'STAFF') = (actor_user_id IS NOT NULL)),
  CONSTRAINT audit_event_operator_label_check CHECK ((actor_kind = 'OPERATOR') = (operator_label IS NOT NULL)),
  CONSTRAINT audit_event_entity_pair_check CHECK ((entity_type IS NULL) = (entity_id IS NULL)),
  CONSTRAINT audit_event_entity_type_check CHECK (entity_type IS NULL OR entity_type IN ('StaffUser','Role','StaffSession','SellerLegalEntity','FileObject','FileVersion','FileLink')),
  CONSTRAINT audit_event_outcome_check CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  CONSTRAINT audit_event_source_hash_check CHECK (source_hash IS NULL OR octet_length(source_hash) = 32),
  CONSTRAINT audit_event_changes_check CHECK (jsonb_typeof(changes) = 'object' AND octet_length(changes::text) <= 4096),
  CONSTRAINT audit_event_registry_check CHECK (audit_event_valid(action,outcome,reason_code,changes))
);
CREATE INDEX audit_event_occurred_id_idx ON audit_event(occurred_at DESC,id DESC);
CREATE INDEX audit_event_actor_occurred_idx ON audit_event(actor_user_id,occurred_at DESC);
CREATE INDEX audit_event_entity_occurred_idx ON audit_event(entity_type,entity_id,occurred_at DESC);
CREATE INDEX audit_event_request_id_idx ON audit_event(request_id);

CREATE TABLE file_object (
  id uuid PRIMARY KEY,
  owner_staff_user_id uuid NOT NULL,
  display_name varchar(255) NOT NULL,
  visibility text NOT NULL,
  state text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT file_object_owner_fk FOREIGN KEY (owner_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_object_visibility_check CHECK (visibility IN ('PRIVATE','INTERNAL')),
  CONSTRAINT file_object_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT file_object_version_check CHECK (version > 0),
  CONSTRAINT file_object_display_name_check CHECK (display_name = btrim(display_name) AND length(display_name) BETWEEN 1 AND 255 AND position('/' in display_name) = 0 AND position(chr(92) in display_name) = 0 AND display_name !~ '[[:cntrl:]]')
);
CREATE INDEX file_object_owner_state_id_idx ON file_object(owner_staff_user_id,state,id);

CREATE TABLE file_version (
  id uuid PRIMARY KEY,
  file_object_id uuid NOT NULL,
  number integer NOT NULL,
  storage_key varchar(128) NOT NULL UNIQUE,
  sha256 bytea NOT NULL,
  size_bytes bigint NOT NULL,
  mime_type varchar(127) NOT NULL,
  original_filename varchar(255) NOT NULL,
  safety_state text NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT file_version_object_fk FOREIGN KEY (file_object_id) REFERENCES file_object(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_version_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_version_object_number_key UNIQUE (file_object_id,number),
  CONSTRAINT file_version_id_object_key UNIQUE (id,file_object_id),
  CONSTRAINT file_version_number_check CHECK (number > 0),
  CONSTRAINT file_version_size_check CHECK (size_bytes BETWEEN 0 AND 9007199254740991),
  CONSTRAINT file_version_sha256_check CHECK (octet_length(sha256) = 32),
  CONSTRAINT file_version_storage_key_check CHECK (storage_key ~ '^[a-f0-9]{64}$'),
  CONSTRAINT file_version_filename_check CHECK (original_filename = btrim(original_filename) AND length(original_filename) BETWEEN 1 AND 255 AND position('/' in original_filename) = 0 AND position(chr(92) in original_filename) = 0 AND original_filename !~ '[[:cntrl:]]'),
  CONSTRAINT file_version_mime_check CHECK (length(mime_type) BETWEEN 3 AND 127 AND mime_type ~ '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,62}$'),
  CONSTRAINT file_version_safety_state_check CHECK (safety_state IN ('UNCHECKED','SAFE','REJECTED'))
);
CREATE INDEX file_version_object_created_idx ON file_version(file_object_id,created_at);

CREATE TABLE file_link (
  id uuid PRIMARY KEY,
  file_object_id uuid NOT NULL,
  file_version_id uuid NOT NULL,
  seller_legal_entity_id uuid NOT NULL,
  visibility text NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT file_link_object_fk FOREIGN KEY (file_object_id) REFERENCES file_object(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_link_version_object_fk FOREIGN KEY (file_version_id,file_object_id) REFERENCES file_version(id,file_object_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_link_seller_fk FOREIGN KEY (seller_legal_entity_id) REFERENCES seller_legal_entity(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_link_creator_fk FOREIGN KEY (created_by_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT file_link_seller_version_key UNIQUE (seller_legal_entity_id,file_version_id),
  CONSTRAINT file_link_visibility_check CHECK (visibility IN ('INTERNAL','PRIVATE'))
);
CREATE INDEX file_link_object_seller_idx ON file_link(file_object_id,seller_legal_entity_id);

CREATE FUNCTION reject_immutable_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER audit_event_no_update_delete BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER file_version_no_update_delete BEFORE UPDATE OR DELETE ON file_version FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();

CREATE FUNCTION reject_immutable_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE TRIGGER file_version_no_truncate BEFORE TRUNCATE ON file_version FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stdu_runtime') THEN
    RAISE EXCEPTION 'Create the separate stdu_runtime database role before applying this migration';
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA public TO stdu_runtime;
GRANT SELECT,INSERT,UPDATE ON staff_user,role,seller_legal_entity,staff_session TO stdu_runtime;
GRANT SELECT,INSERT,DELETE ON user_role,role_permission TO stdu_runtime;
GRANT SELECT ON permission,file_object,file_version,file_link TO stdu_runtime;
GRANT SELECT,INSERT ON audit_event TO stdu_runtime;

INSERT INTO permission(id,code,description) VALUES
 ('00000000-0000-4000-8000-000000000001','staff.users.read','List employees and current role ids; no credentials/sessions.'),
 ('00000000-0000-4000-8000-000000000002','staff.users.create','Create active employee with initial secret and forced password change; no roles implicit.'),
 ('00000000-0000-4000-8000-000000000003','staff.users.status.write','Block/unblock another employee; no self state changes.'),
 ('00000000-0000-4000-8000-000000000004','staff.sessions.revoke','Revoke all sessions of another employee.'),
 ('00000000-0000-4000-8000-000000000005','staff.roles.read','Read role definitions and permission registry.'),
 ('00000000-0000-4000-8000-000000000006','staff.roles.write','Create/rename/archive roles; no permission or assignment implicit.'),
 ('00000000-0000-4000-8000-000000000007','staff.roles.permissions.write','Replace permission set of a role not assigned to the caller; delegation ceiling applies.'),
 ('00000000-0000-4000-8000-000000000008','staff.roles.assign','Assign/remove another employee role; delegation ceiling applies.'),
 ('00000000-0000-4000-8000-000000000009','sellers.read','Read our own seller directory; no customer data.'),
 ('00000000-0000-4000-8000-000000000010','sellers.write','Create/edit/transition own seller directory; no quote/tax-calculation authority.'),
 ('00000000-0000-4000-8000-000000000011','audit.read','Read sanitized global security/admin audit.'),
 ('00000000-0000-4000-8000-000000000012','files.metadata.read','Read authorized file metadata only; no download authority.');
INSERT INTO role(id,code,name,state) VALUES ('10000000-0000-4000-8000-000000000001','bootstrap-admin','Bootstrap administrator','ACTIVE');
INSERT INTO role_permission(role_id,permission_id)
SELECT '10000000-0000-4000-8000-000000000001'::uuid,id FROM permission;

COMMIT;
