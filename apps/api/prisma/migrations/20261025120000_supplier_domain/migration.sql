BEGIN;

CREATE FUNCTION supplier_iso_3166_alpha2_valid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT p_value = ANY(ARRAY[
    'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
    'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
    'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
    'DE','DJ','DK','DM','DO','DZ','EC','EE','EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR',
    'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
    'HK','HM','HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP',
    'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
    'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
    'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
    'QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
    'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW'
  ]::text[])
$$;

CREATE FUNCTION supplier_iso_4217_currency_valid(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT p_value = ANY(ARRAY[
    'AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BHD','BIF','BMD','BND','BOB','BOV','BRL','BSD','BTN','BWP','BYN','BZD',
    'CAD','CDF','CHE','CHF','CHW','CLF','CLP','CNY','COP','COU','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP',
    'GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW',
    'KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR','MZN',
    'NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD',
    'SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','USN','UYI','UYU','UYW',
    'UZS','VED','VES','VND','VUV','WST','XAD','XAF','XAG','XAU','XBA','XBB','XBC','XBD','XCD','XCG','XDR','XOF','XPD','XPF','XPT','XSU','XTS','XUA','XXX','YER','ZAR','ZMW','ZWG'
  ]::text[])
$$;

CREATE FUNCTION supplier_ru_inn_valid(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  digits integer[];
  weights integer[];
  total integer;
  expected integer;
  i integer;
BEGIN
  IF p_value !~ '^(?:[0-9]{10}|[0-9]{12})$' THEN
    RETURN false;
  END IF;
  SELECT array_agg(substr(p_value, n, 1)::integer ORDER BY n)
    INTO digits FROM generate_series(1, length(p_value)) AS n;

  IF length(p_value) = 10 THEN
    weights := ARRAY[2,4,10,3,5,9,4,6,8];
    total := 0;
    FOR i IN 1..9 LOOP total := total + digits[i] * weights[i]; END LOOP;
    expected := (total % 11) % 10;
    RETURN expected = digits[10];
  END IF;

  weights := ARRAY[7,2,4,10,3,5,9,4,6,8];
  total := 0;
  FOR i IN 1..10 LOOP total := total + digits[i] * weights[i]; END LOOP;
  expected := (total % 11) % 10;
  IF expected <> digits[11] THEN RETURN false; END IF;

  weights := ARRAY[3,7,2,4,10,3,5,9,4,6,8];
  total := 0;
  FOR i IN 1..11 LOOP total := total + digits[i] * weights[i]; END LOOP;
  expected := (total % 11) % 10;
  RETURN expected = digits[12];
END;
$$;

CREATE TABLE supplier (
  id uuid PRIMARY KEY,
  legal_name varchar(240) NOT NULL,
  short_name varchar(160),
  tax_identifier varchar(64),
  tax_jurisdiction varchar(2),
  contact_name varchar(160),
  email varchar(254),
  phone varchar(64),
  website varchar(2048),
  internal_notes varchar(4000),
  state text NOT NULL,
  current_revision_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  created_by_staff_user_id uuid NOT NULL,
  updated_by_staff_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT supplier_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT supplier_version_check CHECK (version > 0),
  CONSTRAINT supplier_legal_name_check CHECK (legal_name = btrim(legal_name) AND length(legal_name) BETWEEN 1 AND 240),
  CONSTRAINT supplier_tax_pair_check CHECK ((tax_identifier IS NULL) = (tax_jurisdiction IS NULL)),
  CONSTRAINT supplier_tax_jurisdiction_check CHECK (tax_jurisdiction IS NULL OR supplier_iso_3166_alpha2_valid(tax_jurisdiction)),
  CONSTRAINT supplier_tax_format_check CHECK (
    tax_identifier IS NULL OR
    (tax_jurisdiction = 'RU' AND supplier_ru_inn_valid(tax_identifier)) OR
    (tax_jurisdiction <> 'RU' AND tax_identifier = btrim(normalize(tax_identifier, NFC), ' '))
  ),
  CONSTRAINT supplier_creator_fk FOREIGN KEY (created_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_updater_fk FOREIGN KEY (updated_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX supplier_active_tax_identity_uq
  ON supplier (tax_jurisdiction, tax_identifier COLLATE "C")
  WHERE state = 'ACTIVE' AND tax_identifier IS NOT NULL;
CREATE INDEX supplier_state_updated_id_idx ON supplier(state, updated_at, id);

CREATE TABLE supplier_revision (
  id uuid PRIMARY KEY,
  supplier_id uuid NOT NULL,
  revision_no integer NOT NULL,
  legal_name varchar(240) NOT NULL,
  short_name varchar(160),
  tax_identifier varchar(64),
  tax_jurisdiction varchar(2),
  contact_name varchar(160),
  email varchar(254),
  phone varchar(64),
  website varchar(2048),
  internal_notes varchar(4000),
  recorded_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  recorded_by_staff_user_id uuid NOT NULL,
  CONSTRAINT supplier_revision_id_supplier_key UNIQUE (id, supplier_id),
  CONSTRAINT supplier_revision_supplier_no_key UNIQUE (supplier_id, revision_no),
  CONSTRAINT supplier_revision_no_check CHECK (revision_no > 0),
  CONSTRAINT supplier_revision_legal_name_check CHECK (legal_name = btrim(legal_name) AND length(legal_name) BETWEEN 1 AND 240),
  CONSTRAINT supplier_revision_tax_pair_check CHECK ((tax_identifier IS NULL) = (tax_jurisdiction IS NULL)),
  CONSTRAINT supplier_revision_tax_jurisdiction_check CHECK (tax_jurisdiction IS NULL OR supplier_iso_3166_alpha2_valid(tax_jurisdiction)),
  CONSTRAINT supplier_revision_tax_format_check CHECK (
    tax_identifier IS NULL OR
    (tax_jurisdiction = 'RU' AND supplier_ru_inn_valid(tax_identifier)) OR
    (tax_jurisdiction <> 'RU' AND tax_identifier = btrim(normalize(tax_identifier, NFC), ' '))
  ),
  CONSTRAINT supplier_revision_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_revision_actor_fk FOREIGN KEY (recorded_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX supplier_revision_supplier_no_idx ON supplier_revision(supplier_id, revision_no DESC);
ALTER TABLE supplier
  ADD CONSTRAINT supplier_current_revision_fk
  FOREIGN KEY (current_revision_id, id) REFERENCES supplier_revision(id, supplier_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE supplier_offer (
  id uuid PRIMARY KEY,
  supplier_id uuid NOT NULL,
  state text NOT NULL,
  current_revision_id uuid NOT NULL,
  current_match_proposal_id uuid UNIQUE,
  version integer NOT NULL DEFAULT 1,
  created_by_staff_user_id uuid NOT NULL,
  updated_by_staff_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT supplier_offer_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  CONSTRAINT supplier_offer_version_check CHECK (version > 0),
  CONSTRAINT supplier_offer_supplier_fk FOREIGN KEY (supplier_id) REFERENCES supplier(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_offer_creator_fk FOREIGN KEY (created_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_offer_updater_fk FOREIGN KEY (updated_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX supplier_offer_supplier_state_updated_idx ON supplier_offer(supplier_id,state,updated_at,id);
CREATE INDEX supplier_offer_state_updated_idx ON supplier_offer(state,updated_at,id);

CREATE TABLE supplier_offer_revision (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL,
  revision_no integer NOT NULL,
  supplier_part_number varchar(160),
  offer_name varchar(240),
  source_brand_text varchar(160),
  brand_id uuid,
  manufacturer_name varchar(200),
  original_part_number varchar(160),
  modification varchar(160),
  modification_evidence text NOT NULL,
  purchase_cost numeric,
  currency varchar(3),
  source_vat_text varchar(160),
  availability_text varchar(500),
  lead_time_text varchar(160),
  source_observed_at timestamptz(6),
  expires_at timestamptz(6),
  source_url varchar(2048),
  origin text NOT NULL,
  recorded_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  recorded_by_staff_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT supplier_offer_revision_id_offer_key UNIQUE (id, offer_id),
  CONSTRAINT supplier_offer_revision_offer_no_key UNIQUE (offer_id, revision_no),
  CONSTRAINT supplier_offer_revision_no_check CHECK (revision_no > 0),
  CONSTRAINT supplier_offer_revision_evidence_check CHECK (
    (modification_evidence = 'SPECIFIED' AND modification IS NOT NULL AND modification <> '') OR
    (modification_evidence IN ('CONFIRMED_NONE','UNKNOWN') AND modification IS NULL)
  ),
  CONSTRAINT supplier_offer_revision_money_check CHECK (purchase_cost IS NULL OR purchase_cost > 0),
  CONSTRAINT supplier_offer_revision_currency_check CHECK (currency IS NULL OR supplier_iso_4217_currency_valid(currency)),
  CONSTRAINT supplier_offer_revision_currency_pair_check CHECK (purchase_cost IS NULL OR currency IS NOT NULL),
  CONSTRAINT supplier_offer_revision_origin_check CHECK (origin = 'MANUAL'),
  CONSTRAINT supplier_offer_revision_url_check CHECK (source_url IS NULL OR source_url ~* '^https?://[^[:space:]]+$'),
  CONSTRAINT supplier_offer_revision_offer_fk FOREIGN KEY (offer_id) REFERENCES supplier_offer(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_offer_revision_brand_fk FOREIGN KEY (brand_id) REFERENCES brand(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_offer_revision_actor_fk FOREIGN KEY (recorded_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX supplier_offer_revision_offer_no_idx ON supplier_offer_revision(offer_id,revision_no DESC);
CREATE INDEX supplier_offer_revision_identity_idx ON supplier_offer_revision(brand_id,manufacturer_name,original_part_number,modification);
ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_current_revision_fk
  FOREIGN KEY (current_revision_id, id) REFERENCES supplier_offer_revision(id, offer_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE product_match_proposal (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL,
  offer_revision_id uuid NOT NULL,
  proposed_product_id uuid NOT NULL,
  offer_identity_snapshot jsonb NOT NULL,
  product_identity_snapshot jsonb NOT NULL,
  evidence_kind text NOT NULL,
  state text NOT NULL,
  created_by_staff_user_id uuid NOT NULL,
  created_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  decided_by_staff_user_id uuid,
  decided_at timestamptz(6),
  decision_reason_code varchar(64),
  decision_comment varchar(1000),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT product_match_proposal_id_offer_key UNIQUE (id, offer_id),
  CONSTRAINT product_match_proposal_offer_revision_fk FOREIGN KEY (offer_revision_id, offer_id) REFERENCES supplier_offer_revision(id, offer_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_match_proposal_offer_fk FOREIGN KEY (offer_id) REFERENCES supplier_offer(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_match_proposal_product_fk FOREIGN KEY (proposed_product_id) REFERENCES catalog_product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_match_proposal_creator_fk FOREIGN KEY (created_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_match_proposal_decider_fk FOREIGN KEY (decided_by_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT product_match_proposal_state_check CHECK (state IN ('PENDING','APPROVED','REJECTED')),
  CONSTRAINT product_match_proposal_evidence_check CHECK (evidence_kind = 'STRICT_IDENTITY_EXACT'),
  CONSTRAINT product_match_proposal_version_check CHECK (version > 0),
  CONSTRAINT product_match_proposal_decision_check CHECK (
    (state = 'PENDING' AND decided_by_staff_user_id IS NULL AND decided_at IS NULL AND decision_reason_code IS NULL AND decision_comment IS NULL) OR
    (state IN ('APPROVED','REJECTED') AND decided_by_staff_user_id IS NOT NULL AND decided_at IS NOT NULL AND decision_reason_code IS NOT NULL)
  ),
  CONSTRAINT product_match_proposal_snapshots_check CHECK (
    jsonb_typeof(offer_identity_snapshot) = 'object' AND jsonb_typeof(product_identity_snapshot) = 'object' AND
    offer_identity_snapshot ?& ARRAY['brandId','manufacturerName','originalPartNumber','modification','modificationEvidence']::text[] AND
    product_identity_snapshot ?& ARRAY['brandId','manufacturerName','originalPartNumber','modification']::text[] AND
    offer_identity_snapshot - ARRAY['brandId','manufacturerName','originalPartNumber','modification','modificationEvidence']::text[] = '{}'::jsonb AND
    product_identity_snapshot - ARRAY['brandId','manufacturerName','originalPartNumber','modification']::text[] = '{}'::jsonb AND
    jsonb_typeof(offer_identity_snapshot->'brandId') IN ('string','null') AND
    jsonb_typeof(offer_identity_snapshot->'manufacturerName') IN ('string','null') AND
    jsonb_typeof(offer_identity_snapshot->'originalPartNumber') IN ('string','null') AND
    jsonb_typeof(offer_identity_snapshot->'modification') IN ('string','null') AND
    jsonb_typeof(offer_identity_snapshot->'modificationEvidence') = 'string' AND
    offer_identity_snapshot->>'modificationEvidence' IN ('SPECIFIED','CONFIRMED_NONE','UNKNOWN') AND
    jsonb_typeof(product_identity_snapshot->'brandId') IN ('string','null') AND
    jsonb_typeof(product_identity_snapshot->'manufacturerName') IN ('string','null') AND
    jsonb_typeof(product_identity_snapshot->'originalPartNumber') IN ('string','null') AND
    jsonb_typeof(product_identity_snapshot->'modification') IN ('string','null')
  )
);
CREATE UNIQUE INDEX product_match_one_pending_pair_uq
  ON product_match_proposal(offer_id,offer_revision_id,proposed_product_id)
  WHERE state = 'PENDING';
CREATE INDEX product_match_proposal_state_created_idx ON product_match_proposal(state,created_at,id);
CREATE INDEX product_match_proposal_offer_created_idx ON product_match_proposal(offer_id,created_at,id);
CREATE INDEX product_match_proposal_pair_created_idx ON product_match_proposal(offer_id,offer_revision_id,proposed_product_id,created_at,id);
CREATE INDEX product_match_proposal_product_created_idx ON product_match_proposal(proposed_product_id,created_at,id);
ALTER TABLE supplier_offer
  ADD CONSTRAINT supplier_offer_current_match_fk
  FOREIGN KEY (current_match_proposal_id, id) REFERENCES product_match_proposal(id, offer_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE supplier_command_idempotency (
  id uuid PRIMARY KEY,
  actor_staff_user_id uuid NOT NULL,
  scope varchar(32) NOT NULL,
  idempotency_key varchar(128) COLLATE "C" NOT NULL,
  operation_id varchar(100) NOT NULL,
  request_hash bytea NOT NULL,
  response_status smallint NOT NULL,
  response_body jsonb NOT NULL,
  completed_at timestamptz(6) NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT supplier_command_idempotency_actor_scope_key UNIQUE (actor_staff_user_id,scope,idempotency_key),
  CONSTRAINT supplier_command_idempotency_actor_fk FOREIGN KEY (actor_staff_user_id) REFERENCES staff_user(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT supplier_command_idempotency_scope_check CHECK (scope = 'R1-007'),
  CONSTRAINT supplier_command_idempotency_key_check CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CONSTRAINT supplier_command_idempotency_hash_check CHECK (octet_length(request_hash) = 32),
  CONSTRAINT supplier_command_idempotency_status_check CHECK ((response_status BETWEEN 200 AND 299) OR response_status = 409),
  CONSTRAINT supplier_command_idempotency_response_check CHECK (jsonb_typeof(response_body) = 'object' AND octet_length(response_body::text) <= 8192)
);
CREATE INDEX supplier_command_idempotency_actor_completed_idx ON supplier_command_idempotency(actor_staff_user_id,completed_at DESC);

-- Supplier history and replay results are append-only. Match proposals permit
-- exactly one transition from PENDING to one terminal decision.
CREATE FUNCTION supplier_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_updated_at
  BEFORE UPDATE ON supplier
  FOR EACH ROW EXECUTE FUNCTION supplier_set_updated_at();
CREATE TRIGGER supplier_offer_updated_at
  BEFORE UPDATE ON supplier_offer
  FOR EACH ROW EXECUTE FUNCTION supplier_set_updated_at();

CREATE TRIGGER supplier_revision_no_update_delete
  BEFORE UPDATE OR DELETE ON supplier_revision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER supplier_revision_no_truncate
  BEFORE TRUNCATE ON supplier_revision
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE TRIGGER supplier_offer_revision_no_update_delete
  BEFORE UPDATE OR DELETE ON supplier_offer_revision
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER supplier_offer_revision_no_truncate
  BEFORE TRUNCATE ON supplier_offer_revision
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();
CREATE TRIGGER supplier_command_idempotency_no_update_delete
  BEFORE UPDATE OR DELETE ON supplier_command_idempotency
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_history();
CREATE TRIGGER supplier_command_idempotency_no_truncate
  BEFORE TRUNCATE ON supplier_command_idempotency
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

CREATE FUNCTION supplier_match_proposal_transition_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'PENDING'
       OR NEW.version <> 1
       OR NEW.decided_by_staff_user_id IS NOT NULL
       OR NEW.decided_at IS NOT NULL
       OR NEW.decision_reason_code IS NOT NULL
       OR NEW.decision_comment IS NOT NULL THEN
      RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'PENDING'
     OR NEW.state NOT IN ('APPROVED','REJECTED')
     OR NEW.version <> OLD.version + 1
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.offer_revision_id IS DISTINCT FROM OLD.offer_revision_id
     OR NEW.proposed_product_id IS DISTINCT FROM OLD.proposed_product_id
     OR NEW.offer_identity_snapshot IS DISTINCT FROM OLD.offer_identity_snapshot
     OR NEW.product_identity_snapshot IS DISTINCT FROM OLD.product_identity_snapshot
     OR NEW.evidence_kind IS DISTINCT FROM OLD.evidence_kind
     OR NEW.created_by_staff_user_id IS DISTINCT FROM OLD.created_by_staff_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.decided_by_staff_user_id IS NULL
     OR NEW.decided_at IS NULL
     OR NEW.decision_reason_code IS NULL THEN
    RAISE EXCEPTION 'IMMUTABLE_HISTORY' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_match_proposal_transition_guard
  BEFORE INSERT OR UPDATE OR DELETE ON product_match_proposal
  FOR EACH ROW EXECUTE FUNCTION supplier_match_proposal_transition_guard();
CREATE TRIGGER product_match_proposal_no_truncate
  BEFORE TRUNCATE ON product_match_proposal
  FOR EACH STATEMENT EXECUTE FUNCTION reject_immutable_truncate();

CREATE FUNCTION supplier_assert_current_references()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_revision uuid;
  latest_revision uuid;
  proposal_state text;
  proposal_offer uuid;
BEGIN
  IF TG_TABLE_NAME = 'supplier' THEN
    SELECT s.current_revision_id INTO current_revision
      FROM supplier s WHERE s.id = COALESCE(NEW.id, OLD.id);
    IF current_revision IS NULL THEN RETURN NULL; END IF;
    SELECT r.id INTO latest_revision
      FROM supplier_revision r
      WHERE r.supplier_id = COALESCE(NEW.id, OLD.id)
      ORDER BY r.revision_no DESC LIMIT 1;
    IF current_revision IS DISTINCT FROM latest_revision THEN
      RAISE EXCEPTION 'SUPPLIER_CURRENT_REVISION_INVALID' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM supplier s JOIN supplier_revision r
        ON r.id = s.current_revision_id AND r.supplier_id = s.id
      WHERE s.id = COALESCE(NEW.id, OLD.id)
        AND s.legal_name IS NOT DISTINCT FROM r.legal_name
        AND s.short_name IS NOT DISTINCT FROM r.short_name
        AND s.tax_identifier IS NOT DISTINCT FROM r.tax_identifier
        AND s.tax_jurisdiction IS NOT DISTINCT FROM r.tax_jurisdiction
        AND s.contact_name IS NOT DISTINCT FROM r.contact_name
        AND s.email IS NOT DISTINCT FROM r.email
        AND s.phone IS NOT DISTINCT FROM r.phone
        AND s.website IS NOT DISTINCT FROM r.website
        AND s.internal_notes IS NOT DISTINCT FROM r.internal_notes
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_CURRENT_PROJECTION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_revision' THEN
    SELECT s.current_revision_id INTO current_revision
      FROM supplier s WHERE s.id = COALESCE(NEW.supplier_id, OLD.supplier_id);
    IF current_revision IS NULL THEN RETURN NULL; END IF;
    SELECT r.id INTO latest_revision
      FROM supplier_revision r
      WHERE r.supplier_id = COALESCE(NEW.supplier_id, OLD.supplier_id)
      ORDER BY r.revision_no DESC LIMIT 1;
    IF current_revision IS DISTINCT FROM latest_revision THEN
      RAISE EXCEPTION 'SUPPLIER_CURRENT_REVISION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_offer' THEN
    SELECT o.current_revision_id INTO current_revision
      FROM supplier_offer o WHERE o.id = COALESCE(NEW.id, OLD.id);
    IF current_revision IS NOT NULL THEN
      SELECT r.id INTO latest_revision
        FROM supplier_offer_revision r
        WHERE r.offer_id = COALESCE(NEW.id, OLD.id)
        ORDER BY r.revision_no DESC LIMIT 1;
      IF current_revision IS DISTINCT FROM latest_revision THEN
        RAISE EXCEPTION 'SUPPLIER_OFFER_CURRENT_REVISION_INVALID' USING ERRCODE = '23514';
      END IF;
    END IF;
    SELECT o.current_match_proposal_id, p.state, p.offer_id
      INTO current_revision, proposal_state, proposal_offer
      FROM supplier_offer o LEFT JOIN product_match_proposal p
        ON p.id = o.current_match_proposal_id
      WHERE o.id = COALESCE(NEW.id, OLD.id);
    IF current_revision IS NOT NULL AND
       (proposal_state IS DISTINCT FROM 'APPROVED' OR proposal_offer IS DISTINCT FROM COALESCE(NEW.id, OLD.id)) THEN
      RAISE EXCEPTION 'SUPPLIER_CURRENT_MATCH_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'supplier_offer_revision' THEN
    SELECT o.current_revision_id INTO current_revision
      FROM supplier_offer o WHERE o.id = COALESCE(NEW.offer_id, OLD.offer_id);
    IF current_revision IS NULL THEN RETURN NULL; END IF;
    SELECT r.id INTO latest_revision
      FROM supplier_offer_revision r
      WHERE r.offer_id = COALESCE(NEW.offer_id, OLD.offer_id)
      ORDER BY r.revision_no DESC LIMIT 1;
    IF current_revision IS DISTINCT FROM latest_revision THEN
      RAISE EXCEPTION 'SUPPLIER_OFFER_CURRENT_REVISION_INVALID' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'product_match_proposal' THEN
    IF NEW.state = 'APPROVED' THEN
      SELECT o.current_match_proposal_id INTO current_revision
        FROM supplier_offer o WHERE o.id = NEW.offer_id;
      IF current_revision IS NOT NULL AND current_revision <> NEW.id THEN
        -- A prior approved match may remain historical when a human approves
        -- a replacement proposal; only the root pointer selects the current one.
        RETURN NULL;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER supplier_current_revision_guard
  AFTER INSERT OR UPDATE ON supplier DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_assert_current_references();
CREATE CONSTRAINT TRIGGER supplier_revision_latest_guard
  AFTER INSERT ON supplier_revision DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_assert_current_references();
CREATE CONSTRAINT TRIGGER supplier_offer_current_reference_guard
  AFTER INSERT OR UPDATE ON supplier_offer DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_assert_current_references();
CREATE CONSTRAINT TRIGGER supplier_offer_revision_latest_guard
  AFTER INSERT ON supplier_offer_revision DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION supplier_assert_current_references();

-- Add the five approved codes to the permission registry only. No role receives
-- a permission here; ordinary R1-002 role administration remains the grant path.
INSERT INTO permission(id,code,description) VALUES
  ('30000000-0000-4000-8000-000000000001','suppliers.read','Read staff supplier profiles and private supplier directory data.'),
  ('30000000-0000-4000-8000-000000000002','suppliers.write','Create, edit and archive supplier profiles.'),
  ('30000000-0000-4000-8000-000000000003','suppliers.offers.read','Read supplier offers, revisions, purchase costs and match history.'),
  ('30000000-0000-4000-8000-000000000004','suppliers.offers.write','Create, revise and archive supplier offers.'),
  ('30000000-0000-4000-8000-000000000005','suppliers.matches.decide','Create, decide and unlink individual exact identity match proposals.');

CREATE FUNCTION supplier_audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_entity text;
  v_fields text[];
  v_key text;
  v_value jsonb;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_allowed_change_fields constant text[] := ARRAY[
    'legalName','shortName','taxIdentifier','taxJurisdiction','contactName','email','phone','website','internalNotes',
    'supplierPartNumber','offerName','sourceBrandText','brandId','manufacturerName','originalPartNumber','modification',
    'modificationEvidence','purchaseCost','currency','sourceVatText','availabilityText','leadTimeText','sourceObservedAt','expiresAt','sourceUrl'
  ];
  v_sorted jsonb;
BEGIN
  CASE p_action
    WHEN 'supplier.created' THEN v_entity := 'Supplier'; v_fields := ARRAY['supplierId','revisionId','actorId','version'];
    WHEN 'supplier.changed' THEN v_entity := 'Supplier'; v_fields := ARRAY['supplierId','revisionId','actorId','version','changedFieldNames'];
    WHEN 'supplier.archived' THEN v_entity := 'Supplier'; v_fields := ARRAY['supplierId','actorId','version','reasonCode'];
    WHEN 'supplier_offer.created' THEN v_entity := 'SupplierOffer'; v_fields := ARRAY['supplierId','offerId','revisionId','actorId','version'];
    WHEN 'supplier_offer.revised' THEN v_entity := 'SupplierOffer'; v_fields := ARRAY['supplierId','offerId','revisionId','actorId','version','changedFieldNames'];
    WHEN 'supplier_offer.archived' THEN v_entity := 'SupplierOffer'; v_fields := ARRAY['supplierId','offerId','actorId','version','reasonCode'];
    WHEN 'supplier_match.proposed' THEN v_entity := 'ProductMatchProposal'; v_fields := ARRAY['supplierId','offerId','proposalId','productId','identityEvidenceKind','actorId','version'];
    WHEN 'supplier_match.approved' THEN v_entity := 'ProductMatchProposal'; v_fields := ARRAY['supplierId','offerId','proposalId','productId','actorId','version','outcome','reasonCode'];
    WHEN 'supplier_match.rejected' THEN v_entity := 'ProductMatchProposal'; v_fields := ARRAY['supplierId','offerId','proposalId','productId','actorId','version','outcome','reasonCode'];
    WHEN 'supplier_match.unlinked' THEN v_entity := 'SupplierOffer'; v_fields := ARRAY['supplierId','offerId','previousProposalId','actorId','version','reasonCode'];
    WHEN 'supplier.audit.read' THEN v_entity := 'Supplier|SupplierOffer'; v_fields := ARRAY['entityId','actorId','requestId'];
    ELSE RETURN false;
  END CASE;
  IF p_outcome <> 'SUCCESS' OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object'
     OR (p_reason IS NOT NULL AND p_reason !~ '^[A-Z][A-Z0-9_]{0,63}$') THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_changes)) <> cardinality(v_fields) OR EXISTS (
    SELECT 1 FROM unnest(v_fields) f WHERE NOT (p_changes ? f)
  ) THEN RETURN false; END IF;
  IF (p_action IN ('supplier.archived','supplier_offer.archived','supplier_match.approved','supplier_match.rejected','supplier_match.unlinked')
      AND p_reason IS NULL)
     OR (p_action NOT IN ('supplier.archived','supplier_offer.archived','supplier_match.approved','supplier_match.rejected','supplier_match.unlinked')
      AND p_reason IS NOT NULL) THEN RETURN false; END IF;
  IF p_action = 'supplier.audit.read' THEN
    IF p_changes->>'entityId' IS NULL OR p_changes->>'actorId' IS NULL OR p_changes->>'requestId' IS NULL THEN RETURN false; END IF;
  END IF;
  FOR v_key, v_value IN SELECT key,value FROM jsonb_each(p_changes) LOOP
    IF v_key IN ('supplierId','offerId','revisionId','proposalId','productId','previousProposalId','actorId','entityId','requestId') THEN
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~* v_uuid_pattern THEN RETURN false; END IF;
    ELSIF v_key = 'version' THEN
      IF jsonb_typeof(v_value) <> 'number' OR (v_value #>> '{}') !~ '^[1-9][0-9]*$' OR (v_value #>> '{}')::numeric > 2147483647 THEN RETURN false; END IF;
    ELSIF v_key = 'identityEvidenceKind' THEN
      IF v_value #>> '{}' <> 'STRICT_IDENTITY_EXACT' THEN RETURN false; END IF;
    ELSIF v_key = 'outcome' THEN
      IF v_value #>> '{}' NOT IN ('APPROVED','REJECTED') THEN RETURN false; END IF;
    ELSIF v_key = 'reasonCode' THEN
      IF jsonb_typeof(v_value) <> 'string' OR (v_value #>> '{}') !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN RETURN false; END IF;
    ELSIF v_key = 'changedFieldNames' THEN
      IF jsonb_typeof(v_value) <> 'array' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_value) x
        WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' <> ALL(v_allowed_change_fields)
      ) THEN RETURN false; END IF;
      SELECT COALESCE(jsonb_agg(value ORDER BY value #>> '{}'),'[]'::jsonb) INTO v_sorted
        FROM (SELECT DISTINCT value FROM jsonb_array_elements(v_value)) s;
      IF v_value IS DISTINCT FROM v_sorted THEN RETURN false; END IF;
    ELSE RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION audit_event_valid(p_action text, p_outcome text, p_reason text, p_changes jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE BEGIN ATOMIC
  SELECT CASE
    WHEN p_action LIKE 'supplier.%' OR p_action LIKE 'supplier_offer.%' OR p_action LIKE 'supplier_match.%' THEN public.supplier_audit_event_valid(p_action,p_outcome,p_reason,p_changes)
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
    'CatalogImportRun','CatalogImportRow','Supplier','SupplierRevision','SupplierOffer',
    'SupplierOfferRevision','ProductMatchProposal'
  )
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_supplier_staff_actor_check CHECK (
  (action NOT LIKE 'supplier.%' AND action NOT LIKE 'supplier_offer.%' AND action NOT LIKE 'supplier_match.%') OR actor_kind = 'STAFF'
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_supplier_entity_action_check CHECK (
  (action NOT LIKE 'supplier.%' AND action NOT LIKE 'supplier_offer.%' AND action NOT LIKE 'supplier_match.%')
  OR (action = 'supplier.audit.read' AND entity_type IN ('Supplier','SupplierOffer'))
  OR (action IN ('supplier.created','supplier.changed','supplier.archived') AND entity_type = 'Supplier')
  OR (action IN ('supplier_offer.created','supplier_offer.revised','supplier_offer.archived','supplier_match.unlinked') AND entity_type = 'SupplierOffer')
  OR (action IN ('supplier_match.proposed','supplier_match.approved','supplier_match.rejected') AND entity_type = 'ProductMatchProposal')
);

GRANT SELECT,INSERT,UPDATE ON supplier,supplier_offer TO stdu_runtime;
GRANT SELECT,INSERT ON supplier_revision,supplier_offer_revision,supplier_command_idempotency TO stdu_runtime;
GRANT SELECT,INSERT,UPDATE ON product_match_proposal TO stdu_runtime;
GRANT SELECT ON permission,brand,catalog_product,catalog_product_revision TO stdu_runtime;
GRANT SELECT,INSERT ON audit_event TO stdu_runtime;

COMMIT;
