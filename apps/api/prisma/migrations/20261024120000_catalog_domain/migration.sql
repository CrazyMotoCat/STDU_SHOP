BEGIN;

-- Additive catalog schema for FROZEN R1-004 1.0.0. This file never changes the
-- R1-002 identity migration or the existing staff/audit rows.
-- CreateTable
CREATE TABLE "brand" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "state" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_definition" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "value_type" TEXT NOT NULL,
    "unit_code" VARCHAR(32),
    "unit_label" VARCHAR(48),
    "enum_options" JSONB,
    "filterable" BOOLEAN NOT NULL DEFAULT false,
    "searchable" BOOLEAN NOT NULL DEFAULT false,
    "comparable" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "attribute_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_product" (
    "id" UUID NOT NULL,
    "brand_id" UUID,
    "manufacturer_name" VARCHAR(200),
    "original_part_number" VARCHAR(160),
    "modification" VARCHAR(160),
    "slug" VARCHAR(160) NOT NULL,
    "publication_state" TEXT NOT NULL,
    "published_revision_id" UUID,
    "pending_revision_id" UUID,
    "current_draft_revision_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "catalog_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_product_revision" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "source_revision_id" UUID,
    "brand_id" UUID,
    "category_id" UUID NOT NULL,
    "state" TEXT NOT NULL,
    "display_name" VARCHAR(240) NOT NULL,
    "summary" VARCHAR(500),
    "description" TEXT,
    "brand_name_snapshot" VARCHAR(160),
    "brand_slug_snapshot" VARCHAR(120),
    "category_name_snapshot" VARCHAR(160) NOT NULL,
    "category_slug_snapshot" VARCHAR(120) NOT NULL,
    "manufacturer_name_snapshot" VARCHAR(200),
    "original_part_number_snapshot" VARCHAR(160),
    "modification_snapshot" VARCHAR(160),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "submitted_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision" TEXT,
    "decision_reason" VARCHAR(1000),
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "catalog_product_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attribute_value" (
    "product_revision_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "attribute_definition_id" UUID NOT NULL,
    "value_type" TEXT NOT NULL,
    "code_snapshot" VARCHAR(80) NOT NULL,
    "label_snapshot" VARCHAR(160) NOT NULL,
    "unit_code_snapshot" VARCHAR(32),
    "unit_label_snapshot" VARCHAR(48),
    "filterable_snapshot" BOOLEAN NOT NULL,
    "searchable_snapshot" BOOLEAN NOT NULL,
    "comparable_snapshot" BOOLEAN NOT NULL,
    "text_value" VARCHAR(240),
    "numeric_value" DECIMAL,
    "boolean_value" BOOLEAN,
    "enum_code_value" VARCHAR(80),
    "enum_label_snapshot" VARCHAR(160),

    CONSTRAINT "product_attribute_value_pkey" PRIMARY KEY ("product_revision_id","attribute_definition_id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "product_revision_id" UUID NOT NULL,
    "file_version_id" UUID NOT NULL,
    "alt_text" VARCHAR(240) NOT NULL,
    "caption" VARCHAR(500),
    "sort_order" INTEGER NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("product_revision_id","file_version_id")
);

-- CreateTable
CREATE TABLE "product_document_version" (
    "product_revision_id" UUID NOT NULL,
    "file_version_id" UUID NOT NULL,
    "document_kind" TEXT NOT NULL,
    "display_name" VARCHAR(240) NOT NULL,
    "locale" VARCHAR(35),
    "sort_order" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "product_document_version_pkey" PRIMARY KEY ("product_revision_id","file_version_id")
);

-- CreateTable
CREATE TABLE "product_relation" (
    "source_revision_id" UUID NOT NULL,
    "target_product_id" UUID NOT NULL,
    "target_revision_id" UUID NOT NULL,
    "relation_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "product_relation_pkey" PRIMARY KEY ("source_revision_id","target_product_id","relation_type")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_slug_key" ON "brand"("slug");

-- CreateIndex
CREATE INDEX "brand_state_name_id_idx" ON "brand"("state", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE INDEX "category_parent_state_sort_slug_idx" ON "category"("parent_id", "state", "sort_order", "slug");

-- CreateIndex
CREATE INDEX "category_state_id_idx" ON "category"("state", "id");

-- CreateIndex
CREATE INDEX "attribute_definition_category_state_code_idx" ON "attribute_definition"("category_id", "state", "code");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definition_category_code_key" ON "attribute_definition"("category_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definition_identity_key" ON "attribute_definition"("id", "category_id", "value_type");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_product_slug_key" ON "catalog_product"("slug");

-- CreateIndex
CREATE INDEX "catalog_product_state_updated_id_idx" ON "catalog_product"("publication_state", "updated_at", "id");

-- CreateIndex
CREATE INDEX "catalog_product_brand_state_id_idx" ON "catalog_product"("brand_id", "publication_state", "id");

-- CreateIndex
CREATE INDEX "catalog_product_part_number_id_idx" ON "catalog_product"("original_part_number", "id");

-- CreateIndex
CREATE INDEX "catalog_product_revision_product_no_idx" ON "catalog_product_revision"("product_id", "revision_no" DESC);

-- CreateIndex
CREATE INDEX "catalog_product_revision_state_created_id_idx" ON "catalog_product_revision"("state", "created_at", "id");

-- CreateIndex
CREATE INDEX "catalog_product_revision_category_state_product_idx" ON "catalog_product_revision"("category_id", "state", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_product_revision_product_no_key" ON "catalog_product_revision"("product_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_product_revision_id_product_key" ON "catalog_product_revision"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_product_revision_id_category_key" ON "catalog_product_revision"("id", "category_id");

-- CreateIndex
CREATE INDEX "product_attribute_value_text_idx" ON "product_attribute_value"("attribute_definition_id", "text_value", "product_revision_id");

-- CreateIndex
CREATE INDEX "product_attribute_value_numeric_idx" ON "product_attribute_value"("attribute_definition_id", "numeric_value", "product_revision_id");

-- CreateIndex
CREATE INDEX "product_attribute_value_enum_idx" ON "product_attribute_value"("attribute_definition_id", "enum_code_value", "product_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_revision_sort_key" ON "product_media"("product_revision_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_document_revision_sort_key" ON "product_document_version"("product_revision_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_relation_source_sort_key" ON "product_relation"("source_revision_id", "sort_order");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attribute_definition" ADD CONSTRAINT "attribute_definition_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_published_revision_id_id_fkey" FOREIGN KEY ("published_revision_id", "id") REFERENCES "catalog_product_revision"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_pending_revision_id_id_fkey" FOREIGN KEY ("pending_revision_id", "id") REFERENCES "catalog_product_revision"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product" ADD CONSTRAINT "catalog_product_current_draft_revision_id_id_fkey" FOREIGN KEY ("current_draft_revision_id", "id") REFERENCES "catalog_product_revision"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog_product"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_source_revision_id_product_id_fkey" FOREIGN KEY ("source_revision_id", "product_id") REFERENCES "catalog_product_revision"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "catalog_product_revision" ADD CONSTRAINT "catalog_product_revision_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_attribute_value" ADD CONSTRAINT "product_attribute_value_product_revision_id_category_id_fkey" FOREIGN KEY ("product_revision_id", "category_id") REFERENCES "catalog_product_revision"("id", "category_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_attribute_value" ADD CONSTRAINT "product_attribute_value_attribute_definition_id_category_i_fkey" FOREIGN KEY ("attribute_definition_id", "category_id", "value_type") REFERENCES "attribute_definition"("id", "category_id", "value_type") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_revision_id_fkey" FOREIGN KEY ("product_revision_id") REFERENCES "catalog_product_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "file_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_document_version" ADD CONSTRAINT "product_document_version_product_revision_id_fkey" FOREIGN KEY ("product_revision_id") REFERENCES "catalog_product_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_document_version" ADD CONSTRAINT "product_document_version_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "file_version"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_document_version" ADD CONSTRAINT "product_document_version_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "catalog_product_revision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_target_revision_id_target_product_id_fkey" FOREIGN KEY ("target_revision_id", "target_product_id") REFERENCES "catalog_product_revision"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "product_relation" ADD CONSTRAINT "product_relation_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "staff_user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- The three product pointers form intentional cycles through immutable
-- CatalogProductRevision rows. Deferral lets a single transaction replace a
-- draft and publish/withdraw a revision while exposing only the final state.
ALTER TABLE catalog_product
  DROP CONSTRAINT catalog_product_published_revision_id_id_fkey,
  DROP CONSTRAINT catalog_product_pending_revision_id_id_fkey,
  DROP CONSTRAINT catalog_product_current_draft_revision_id_id_fkey,
  ADD CONSTRAINT catalog_product_published_revision_fk
    FOREIGN KEY (published_revision_id, id)
    REFERENCES catalog_product_revision(id, product_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT catalog_product_pending_revision_fk
    FOREIGN KEY (pending_revision_id, id)
    REFERENCES catalog_product_revision(id, product_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT catalog_product_current_draft_revision_fk
    FOREIGN KEY (current_draft_revision_id, id)
    REFERENCES catalog_product_revision(id, product_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- Composite constraints below cannot be expressed by Prisma's schema DSL.
-- They are mirrored by the frozen data-model JSON and checked at runtime.
CREATE UNIQUE INDEX catalog_product_revision_one_draft_key
  ON catalog_product_revision(product_id) WHERE state = 'DRAFT';
CREATE UNIQUE INDEX catalog_product_revision_one_pending_key
  ON catalog_product_revision(product_id) WHERE state = 'PENDING_REVIEW';
CREATE UNIQUE INDEX product_media_one_primary_key
  ON product_media(product_revision_id) WHERE is_primary;
CREATE UNIQUE INDEX catalog_product_identity_exact_key
  ON catalog_product (
    brand_id,
    (normalize(btrim(manufacturer_name, ' '), NFC) COLLATE "C"),
    (normalize(btrim(original_part_number, ' '), NFC) COLLATE "C"),
    (coalesce(normalize(btrim(modification, ' '), NFC), '') COLLATE "C")
  )
  WHERE brand_id IS NOT NULL
    AND manufacturer_name IS NOT NULL
    AND original_part_number IS NOT NULL;

CREATE FUNCTION catalog_enum_options_valid(p_options jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  IF p_options IS NULL OR jsonb_typeof(p_options) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_options) = 0 THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_options) AS option_row(value)
    WHERE jsonb_typeof(value) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(value)) <> 2
      OR NOT (value ? 'code' AND value ? 'label')
      OR jsonb_typeof(value->'code') <> 'string'
      OR jsonb_typeof(value->'label') <> 'string'
      OR (value->>'code') !~ '^[a-z][a-z0-9_-]{0,79}$'
      OR char_length(btrim(value->>'label', ' ')) NOT BETWEEN 1 AND 160
      OR value->>'label' <> btrim(value->>'label', ' ')
  )
  AND (SELECT count(*) = count(DISTINCT value->>'code')
       FROM jsonb_array_elements(p_options) AS option_row(value));
END;
$$;

ALTER TABLE brand
  ADD CONSTRAINT brand_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  ADD CONSTRAINT brand_version_check CHECK (version > 0),
  ADD CONSTRAINT brand_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT brand_name_check CHECK (
    name = btrim(name, ' ') AND char_length(name) BETWEEN 1 AND 160
  );

ALTER TABLE category
  ADD CONSTRAINT category_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  ADD CONSTRAINT category_version_check CHECK (version > 0),
  ADD CONSTRAINT category_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT category_name_check CHECK (
    name = btrim(name, ' ') AND char_length(name) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT category_parent_not_self_check CHECK (parent_id IS NULL OR parent_id <> id),
  ADD CONSTRAINT category_sort_order_check CHECK (sort_order >= 0),
  ADD CONSTRAINT category_description_check CHECK (
    description IS NULL OR char_length(description) <= 2000
  );

ALTER TABLE attribute_definition
  ADD CONSTRAINT attribute_definition_state_check CHECK (state IN ('ACTIVE','ARCHIVED')),
  ADD CONSTRAINT attribute_definition_version_check CHECK (version > 0),
  ADD CONSTRAINT attribute_definition_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  ADD CONSTRAINT attribute_definition_label_check CHECK (
    label = btrim(label, ' ') AND char_length(label) BETWEEN 1 AND 160
  ),
  ADD CONSTRAINT attribute_definition_type_check CHECK (
    value_type IN ('TEXT','DECIMAL','INTEGER','BOOLEAN','ENUM')
  ),
  ADD CONSTRAINT attribute_definition_unit_pair_check CHECK (
    (unit_code IS NULL) = (unit_label IS NULL)
  ),
  ADD CONSTRAINT attribute_definition_unit_type_check CHECK (
    unit_code IS NULL OR value_type IN ('DECIMAL','INTEGER')
  ),
  ADD CONSTRAINT attribute_definition_enum_options_check CHECK (
    (value_type = 'ENUM' AND catalog_enum_options_valid(enum_options))
    OR (value_type <> 'ENUM' AND enum_options IS NULL)
  );

ALTER TABLE catalog_product
  ADD CONSTRAINT catalog_product_state_check CHECK (
    publication_state IN ('DRAFT','PENDING_REVIEW','PUBLISHED','ARCHIVED')
  ),
  ADD CONSTRAINT catalog_product_version_check CHECK (version > 0),
  ADD CONSTRAINT catalog_product_slug_check CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  ADD CONSTRAINT catalog_product_identity_nonempty_check CHECK (
    (manufacturer_name IS NULL OR (
      manufacturer_name = btrim(manufacturer_name, ' ')
      AND char_length(manufacturer_name) BETWEEN 1 AND 200
      AND manufacturer_name = normalize(manufacturer_name, NFC)
    ))
    AND (original_part_number IS NULL OR (
      original_part_number = btrim(original_part_number, ' ')
      AND char_length(original_part_number) BETWEEN 1 AND 160
      AND original_part_number = normalize(original_part_number, NFC)
    ))
    AND (modification IS NULL OR (
      modification = btrim(modification, ' ')
      AND char_length(modification) BETWEEN 1 AND 160
      AND modification = normalize(modification, NFC)
    ))
  ),
  ADD CONSTRAINT catalog_product_archived_pointers_check CHECK (
    publication_state <> 'ARCHIVED'
    OR (published_revision_id IS NULL
      AND pending_revision_id IS NULL
      AND current_draft_revision_id IS NULL)
  );

ALTER TABLE catalog_product_revision
  ADD CONSTRAINT catalog_product_revision_no_check CHECK (revision_no > 0),
  ADD CONSTRAINT catalog_product_revision_state_check CHECK (
    state IN ('DRAFT','SUPERSEDED','PENDING_REVIEW','PUBLISHED','RETURNED','REJECTED','WITHDRAWN')
  ),
  ADD CONSTRAINT catalog_product_revision_display_name_check CHECK (
    display_name = btrim(display_name, ' ') AND char_length(display_name) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT catalog_product_revision_summary_check CHECK (
    summary IS NULL OR char_length(summary) <= 500
  ),
  ADD CONSTRAINT catalog_product_revision_description_check CHECK (
    description IS NULL OR char_length(description) <= 20000
  ),
  ADD CONSTRAINT catalog_product_revision_snapshot_check CHECK (
    category_name_snapshot = btrim(category_name_snapshot, ' ')
    AND char_length(category_name_snapshot) BETWEEN 1 AND 160
    AND category_slug_snapshot ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    AND ((brand_id IS NULL AND brand_name_snapshot IS NULL AND brand_slug_snapshot IS NULL)
      OR (brand_id IS NOT NULL AND brand_name_snapshot IS NOT NULL AND brand_slug_snapshot IS NOT NULL
        AND brand_name_snapshot = btrim(brand_name_snapshot, ' ')
        AND char_length(brand_name_snapshot) BETWEEN 1 AND 160
        AND brand_slug_snapshot ~ '^[a-z0-9]+(-[a-z0-9]+)*$'))
  ),
  ADD CONSTRAINT catalog_product_revision_identity_snapshot_check CHECK (
    (manufacturer_name_snapshot IS NULL OR (
      manufacturer_name_snapshot = btrim(manufacturer_name_snapshot, ' ')
      AND char_length(manufacturer_name_snapshot) BETWEEN 1 AND 200
      AND manufacturer_name_snapshot = normalize(manufacturer_name_snapshot, NFC)
    ))
    AND (original_part_number_snapshot IS NULL OR (
      original_part_number_snapshot = btrim(original_part_number_snapshot, ' ')
      AND char_length(original_part_number_snapshot) BETWEEN 1 AND 160
      AND original_part_number_snapshot = normalize(original_part_number_snapshot, NFC)
    ))
    AND (modification_snapshot IS NULL OR (
      modification_snapshot = btrim(modification_snapshot, ' ')
      AND char_length(modification_snapshot) BETWEEN 1 AND 160
      AND modification_snapshot = normalize(modification_snapshot, NFC)
    ))
  ),
  ADD CONSTRAINT catalog_product_revision_submit_pair_check CHECK (
    (submitted_at IS NULL) = (submitted_by_user_id IS NULL)
  ),
  ADD CONSTRAINT catalog_product_revision_decision_pair_check CHECK (
    (decided_at IS NULL) = (decided_by_user_id IS NULL)
  ),
  ADD CONSTRAINT catalog_product_revision_decision_check CHECK (
    decision IS NULL OR decision IN ('PUBLISH','RETURN_FOR_CHANGES','REJECT')
  ),
  ADD CONSTRAINT catalog_product_revision_state_decision_check CHECK (
    (state = 'PUBLISHED' AND decision = 'PUBLISH'
      AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND published_at IS NOT NULL)
    OR (state = 'RETURNED' AND decision = 'RETURN_FOR_CHANGES'
      AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND published_at IS NULL)
    OR (state = 'REJECTED' AND decision = 'REJECT'
      AND decided_at IS NOT NULL AND decided_by_user_id IS NOT NULL AND published_at IS NULL)
    OR (state IN ('DRAFT','SUPERSEDED','PENDING_REVIEW','WITHDRAWN')
      AND decision IS NULL AND decided_at IS NULL AND decided_by_user_id IS NULL AND published_at IS NULL)
  ),
  ADD CONSTRAINT catalog_product_revision_submitted_state_check CHECK (
    (state = 'DRAFT' AND submitted_at IS NULL)
    OR state = 'SUPERSEDED'
    OR (state IN ('PENDING_REVIEW','PUBLISHED','RETURNED','REJECTED','WITHDRAWN')
      AND submitted_at IS NOT NULL)
  );

ALTER TABLE product_attribute_value
  ADD CONSTRAINT product_attribute_value_type_check CHECK (
    value_type IN ('TEXT','DECIMAL','INTEGER','BOOLEAN','ENUM')
  ),
  ADD CONSTRAINT product_attribute_value_typed_column_check CHECK (
    (value_type = 'TEXT' AND text_value IS NOT NULL AND numeric_value IS NULL
      AND boolean_value IS NULL AND enum_code_value IS NULL AND enum_label_snapshot IS NULL)
    OR (value_type = 'DECIMAL' AND text_value IS NULL AND numeric_value IS NOT NULL
      AND boolean_value IS NULL AND enum_code_value IS NULL AND enum_label_snapshot IS NULL)
    OR (value_type = 'INTEGER' AND text_value IS NULL AND numeric_value IS NOT NULL
      AND scale(numeric_value) = 0 AND boolean_value IS NULL
      AND enum_code_value IS NULL AND enum_label_snapshot IS NULL)
    OR (value_type = 'BOOLEAN' AND text_value IS NULL AND numeric_value IS NULL
      AND boolean_value IS NOT NULL AND enum_code_value IS NULL AND enum_label_snapshot IS NULL)
    OR (value_type = 'ENUM' AND text_value IS NULL AND numeric_value IS NULL
      AND boolean_value IS NULL AND enum_code_value IS NOT NULL AND enum_label_snapshot IS NOT NULL
      AND enum_code_value ~ '^[a-z][a-z0-9_-]{0,79}$'
      AND enum_label_snapshot = btrim(enum_label_snapshot, ' ')
      AND char_length(enum_label_snapshot) BETWEEN 1 AND 160)
  ),
  ADD CONSTRAINT product_attribute_value_text_check CHECK (
    text_value IS NULL OR char_length(text_value) <= 240
  );

ALTER TABLE product_media
  ADD CONSTRAINT product_media_sort_order_check CHECK (sort_order >= 0),
  ADD CONSTRAINT product_media_alt_text_check CHECK (
    alt_text = btrim(alt_text, ' ') AND char_length(alt_text) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT product_media_caption_check CHECK (
    caption IS NULL OR char_length(caption) <= 500
  );

ALTER TABLE product_document_version
  ADD CONSTRAINT product_document_kind_check CHECK (
    document_kind IN ('DATASHEET','MANUAL','CERTIFICATE','SCHEME','OTHER')
  ),
  ADD CONSTRAINT product_document_sort_order_check CHECK (sort_order >= 0),
  ADD CONSTRAINT product_document_display_name_check CHECK (
    display_name = btrim(display_name, ' ') AND char_length(display_name) BETWEEN 1 AND 240
  ),
  ADD CONSTRAINT product_document_locale_check CHECK (
    locale IS NULL OR (char_length(locale) BETWEEN 2 AND 35
      AND locale ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$')
  );

ALTER TABLE product_relation
  ADD CONSTRAINT product_relation_type_check CHECK (
    relation_type IN ('ACCESSORY','COMPATIBLE_EQUIPMENT')
  ),
  ADD CONSTRAINT product_relation_sort_order_check CHECK (sort_order >= 0);

CREATE FUNCTION catalog_reference_version_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'VERSION_CONFLICT' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER brand_version_guard BEFORE UPDATE ON brand
  FOR EACH ROW EXECUTE FUNCTION catalog_reference_version_guard();
CREATE TRIGGER category_version_guard BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION catalog_reference_version_guard();
CREATE TRIGGER attribute_definition_version_guard BEFORE UPDATE ON attribute_definition
  FOR EACH ROW EXECUTE FUNCTION catalog_reference_version_guard();
CREATE TRIGGER catalog_product_version_guard BEFORE UPDATE ON catalog_product
  FOR EACH ROW EXECUTE FUNCTION catalog_reference_version_guard();

CREATE FUNCTION catalog_brand_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state = 'ARCHIVED' AND OLD.state <> 'ARCHIVED'
     AND EXISTS (SELECT 1 FROM catalog_product p WHERE p.brand_id = OLD.id AND p.publication_state <> 'ARCHIVED') THEN
    RAISE EXCEPTION 'REFERENCE_IN_USE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_brand_guard BEFORE INSERT OR UPDATE ON brand
  FOR EACH ROW EXECUTE FUNCTION catalog_brand_guard();

CREATE FUNCTION catalog_category_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_state text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
     OR (NEW.state = 'ARCHIVED' AND OLD.state <> 'ARCHIVED') THEN
    PERFORM pg_advisory_xact_lock(1398031445, 3);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'CATEGORY_CYCLE' USING ERRCODE = '23514';
    END IF;
    SELECT state INTO parent_state FROM category WHERE id = NEW.parent_id FOR UPDATE;
    IF parent_state IS DISTINCT FROM 'ACTIVE' THEN
      RAISE EXCEPTION 'CATEGORY_INACTIVE_PARENT' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      WITH RECURSIVE descendants(id) AS (
        SELECT NEW.id
        UNION
        SELECT child.id FROM category child JOIN descendants d ON child.parent_id = d.id
      )
      SELECT 1 FROM descendants WHERE id = NEW.parent_id
    ) THEN
      RAISE EXCEPTION 'CATEGORY_CYCLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.state = 'ARCHIVED' AND OLD.state <> 'ARCHIVED' THEN
    IF EXISTS (SELECT 1 FROM category child WHERE child.parent_id = OLD.id AND child.state = 'ACTIVE')
       OR EXISTS (
         SELECT 1
         FROM catalog_product p
         JOIN catalog_product_revision r ON r.id IN (
           p.current_draft_revision_id, p.pending_revision_id, p.published_revision_id
         )
         WHERE p.publication_state <> 'ARCHIVED' AND r.category_id = OLD.id
       ) THEN
      RAISE EXCEPTION 'REFERENCE_IN_USE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_category_guard BEFORE INSERT OR UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION catalog_category_guard();

CREATE FUNCTION catalog_attribute_definition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM category WHERE id = NEW.category_id AND state = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CATEGORY_INACTIVE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM product_attribute_value WHERE attribute_definition_id = OLD.id
  ) AND (
    NEW.code IS DISTINCT FROM OLD.code
    OR NEW.value_type IS DISTINCT FROM OLD.value_type
    OR NEW.unit_code IS DISTINCT FROM OLD.unit_code
    OR NEW.unit_label IS DISTINCT FROM OLD.unit_label
    OR NEW.enum_options IS DISTINCT FROM OLD.enum_options
    OR NEW.filterable IS DISTINCT FROM OLD.filterable
    OR NEW.searchable IS DISTINCT FROM OLD.searchable
    OR NEW.comparable IS DISTINCT FROM OLD.comparable
  ) THEN
    RAISE EXCEPTION 'ATTRIBUTE_IN_USE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_attribute_definition_guard BEFORE INSERT OR UPDATE ON attribute_definition
  FOR EACH ROW EXECUTE FUNCTION catalog_attribute_definition_guard();

CREATE FUNCTION catalog_product_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.publication_state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF NEW.brand_id IS NOT NULL THEN
    PERFORM 1 FROM brand WHERE id = NEW.brand_id AND state = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BRAND_INACTIVE' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW.brand_id IS DISTINCT FROM OLD.brand_id
    OR NEW.manufacturer_name IS DISTINCT FROM OLD.manufacturer_name
    OR NEW.original_part_number IS DISTINCT FROM OLD.original_part_number
    OR NEW.modification IS DISTINCT FROM OLD.modification
  ) AND EXISTS (
    SELECT 1 FROM catalog_product_revision r
    WHERE r.product_id = OLD.id AND r.submitted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_product_identity_guard BEFORE INSERT OR UPDATE ON catalog_product
  FOR EACH ROW EXECUTE FUNCTION catalog_product_identity_guard();

CREATE FUNCTION catalog_revision_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p catalog_product%ROWTYPE;
  c category%ROWTYPE;
  b brand%ROWTYPE;
BEGIN
  SELECT * INTO p FROM catalog_product WHERE id = NEW.product_id FOR SHARE;
  IF NOT FOUND OR p.publication_state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'PRODUCT_NOT_EDITABLE' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM category WHERE id = NEW.category_id FOR SHARE;
  IF NOT FOUND OR c.state <> 'ACTIVE' THEN
    RAISE EXCEPTION 'CATEGORY_INACTIVE' USING ERRCODE = '23514';
  END IF;
  IF NEW.brand_id IS NULL THEN
    IF NEW.brand_name_snapshot IS NOT NULL OR NEW.brand_slug_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'REVISION_REFERENCE_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO b FROM brand WHERE id = NEW.brand_id FOR SHARE;
    IF NOT FOUND OR b.state <> 'ACTIVE'
       OR NEW.brand_name_snapshot IS DISTINCT FROM b.name
       OR NEW.brand_slug_snapshot IS DISTINCT FROM b.slug THEN
      RAISE EXCEPTION 'REVISION_REFERENCE_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.category_name_snapshot IS DISTINCT FROM c.name
     OR NEW.category_slug_snapshot IS DISTINCT FROM c.slug
     OR NEW.brand_id IS DISTINCT FROM p.brand_id
     OR NEW.manufacturer_name_snapshot IS DISTINCT FROM p.manufacturer_name
     OR NEW.original_part_number_snapshot IS DISTINCT FROM p.original_part_number
     OR NEW.modification_snapshot IS DISTINCT FROM p.modification THEN
    RAISE EXCEPTION 'REVISION_REFERENCE_SNAPSHOT_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_revision_insert_guard BEFORE INSERT ON catalog_product_revision
  FOR EACH ROW EXECUTE FUNCTION catalog_revision_insert_guard();

CREATE FUNCTION catalog_revision_workflow_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_REVISION' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['state','submitted_by_user_id','submitted_at','decided_by_user_id','decided_at','decision','decision_reason','published_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['state','submitted_by_user_id','submitted_at','decided_by_user_id','decided_at','decision','decision_reason','published_at']) THEN
    RAISE EXCEPTION 'IMMUTABLE_REVISION' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = OLD.state THEN
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state = 'SUPERSEDED' THEN
    IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state = 'DRAFT' AND NEW.state = 'PENDING_REVIEW' THEN
    IF NEW.submitted_at IS NULL OR NEW.submitted_by_user_id IS NULL
       OR NEW.decided_at IS NOT NULL OR NEW.decided_by_user_id IS NOT NULL
       OR NEW.decision IS NOT NULL OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state = 'PENDING_REVIEW' AND NEW.state IN ('PUBLISHED','RETURNED','REJECTED') THEN
    IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id
       OR NEW.decided_at IS NULL OR NEW.decided_by_user_id IS NULL
       OR NEW.decision IS NULL
       OR (NEW.state = 'PUBLISHED' AND (NEW.decision <> 'PUBLISH' OR NEW.published_at IS NULL))
       OR (NEW.state = 'RETURNED' AND (NEW.decision <> 'RETURN_FOR_CHANGES' OR NEW.published_at IS NOT NULL))
       OR (NEW.state = 'REJECTED' AND (NEW.decision <> 'REJECT' OR NEW.published_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD.state = 'PENDING_REVIEW' AND NEW.state = 'WITHDRAWN' THEN
    IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id
       OR NEW.decided_at IS NOT NULL OR NEW.decided_by_user_id IS NOT NULL
       OR NEW.decision IS NOT NULL OR NEW.published_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_STATE_TRANSITION' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalog_revision_workflow_guard BEFORE UPDATE OR DELETE ON catalog_product_revision
  FOR EACH ROW EXECUTE FUNCTION catalog_revision_workflow_guard();

CREATE FUNCTION catalog_check_product_workflow()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  product_id_value uuid;
  archived_pending_revision_id uuid;
  product_row catalog_product%ROWTYPE;
  revision_state text;
  expected_state text;
BEGIN
  IF TG_TABLE_NAME = 'catalog_product' THEN
    product_id_value := COALESCE(NEW.id, OLD.id);
    IF TG_OP = 'UPDATE' AND NEW.publication_state = 'ARCHIVED'
       AND OLD.publication_state <> 'ARCHIVED' THEN
      archived_pending_revision_id := OLD.pending_revision_id;
    END IF;
  ELSE
    product_id_value := COALESCE(NEW.product_id, OLD.product_id);
  END IF;
  SELECT * INTO product_row FROM catalog_product WHERE id = product_id_value;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF product_row.publication_state = 'ARCHIVED' THEN
    IF product_row.published_revision_id IS NOT NULL
       OR product_row.pending_revision_id IS NOT NULL
       OR product_row.current_draft_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
    END IF;
    IF archived_pending_revision_id IS NOT NULL THEN
      SELECT state INTO revision_state FROM catalog_product_revision
        WHERE id = archived_pending_revision_id AND product_id = product_id_value;
      IF revision_state IS DISTINCT FROM 'WITHDRAWN' THEN
        RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM catalog_product_revision
      WHERE product_id = product_id_value AND state = 'PENDING_REVIEW'
    ) THEN
      RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
  END IF;
  IF product_row.published_revision_id IS NOT NULL THEN
    SELECT state INTO revision_state FROM catalog_product_revision
      WHERE id = product_row.published_revision_id AND product_id = product_id_value;
    IF revision_state IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF product_row.pending_revision_id IS NOT NULL THEN
    SELECT state INTO revision_state FROM catalog_product_revision
      WHERE id = product_row.pending_revision_id AND product_id = product_id_value;
    IF revision_state IS DISTINCT FROM 'PENDING_REVIEW' THEN
      RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF product_row.current_draft_revision_id IS NOT NULL THEN
    SELECT state INTO revision_state FROM catalog_product_revision
      WHERE id = product_row.current_draft_revision_id AND product_id = product_id_value;
    IF revision_state IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
    END IF;
  END IF;
  expected_state := CASE
    WHEN product_row.pending_revision_id IS NOT NULL THEN 'PENDING_REVIEW'
    WHEN product_row.published_revision_id IS NOT NULL THEN 'PUBLISHED'
    ELSE 'DRAFT'
  END;
  IF product_row.publication_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'CATALOG_WORKFLOW_INCONSISTENT' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER catalog_product_workflow_consistency
  AFTER INSERT OR UPDATE ON catalog_product
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog_check_product_workflow();
CREATE CONSTRAINT TRIGGER catalog_revision_workflow_consistency
  AFTER INSERT OR UPDATE ON catalog_product_revision
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION catalog_check_product_workflow();

CREATE FUNCTION catalog_child_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  root_draft_revision_id uuid;
  root_state text;
  revision_state text;
  root_id uuid;
BEGIN
  SELECT product_id INTO root_id
    FROM catalog_product_revision WHERE id = NEW.product_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVISION_NOT_EDITABLE' USING ERRCODE = '23514';
  END IF;
  SELECT current_draft_revision_id, publication_state
    INTO root_draft_revision_id, root_state
    FROM catalog_product WHERE id = root_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVISION_NOT_EDITABLE' USING ERRCODE = '23514';
  END IF;
  SELECT state INTO revision_state
    FROM catalog_product_revision
    WHERE id = NEW.product_revision_id AND product_id = root_id FOR SHARE;
  IF NOT FOUND OR revision_state <> 'DRAFT'
     OR root_draft_revision_id IS DISTINCT FROM NEW.product_revision_id
     OR root_state = 'ARCHIVED' THEN
    RAISE EXCEPTION 'REVISION_NOT_EDITABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION catalog_relation_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_product_id uuid;
  source_state text;
BEGIN
  SELECT product_id, state INTO source_product_id, source_state
    FROM catalog_product_revision WHERE id = NEW.source_revision_id FOR SHARE;
  IF NOT FOUND OR source_state <> 'DRAFT' OR NOT EXISTS (
    SELECT 1 FROM catalog_product
    WHERE id = source_product_id AND current_draft_revision_id = NEW.source_revision_id
      AND publication_state <> 'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'REVISION_NOT_EDITABLE' USING ERRCODE = '23514';
  END IF;
  IF source_product_id = NEW.target_product_id THEN
    RAISE EXCEPTION 'RELATION_TARGET_INVALID' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM catalog_product target
    WHERE target.id = NEW.target_product_id AND target.publication_state <> 'ARCHIVED'
      AND target.published_revision_id = NEW.target_revision_id
  ) THEN
    RAISE EXCEPTION 'RELATION_TARGET_REVISION_STALE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION catalog_child_immutable_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_REVISION_CONTENT' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER product_attribute_value_insert_guard BEFORE INSERT ON product_attribute_value
  FOR EACH ROW EXECUTE FUNCTION catalog_child_insert_guard();
CREATE TRIGGER product_attribute_value_immutable BEFORE UPDATE OR DELETE ON product_attribute_value
  FOR EACH ROW EXECUTE FUNCTION catalog_child_immutable_guard();
CREATE TRIGGER product_media_insert_guard BEFORE INSERT ON product_media
  FOR EACH ROW EXECUTE FUNCTION catalog_child_insert_guard();
CREATE TRIGGER product_media_immutable BEFORE UPDATE OR DELETE ON product_media
  FOR EACH ROW EXECUTE FUNCTION catalog_child_immutable_guard();
CREATE TRIGGER product_document_insert_guard BEFORE INSERT ON product_document_version
  FOR EACH ROW EXECUTE FUNCTION catalog_child_insert_guard();
CREATE TRIGGER product_document_immutable BEFORE UPDATE OR DELETE ON product_document_version
  FOR EACH ROW EXECUTE FUNCTION catalog_child_immutable_guard();
CREATE TRIGGER product_relation_insert_guard BEFORE INSERT ON product_relation
  FOR EACH ROW EXECUTE FUNCTION catalog_relation_insert_guard();
CREATE TRIGGER product_relation_immutable BEFORE UPDATE OR DELETE ON product_relation
  FOR EACH ROW EXECUTE FUNCTION catalog_child_immutable_guard();

CREATE FUNCTION catalog_attribute_value_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition attribute_definition%ROWTYPE;
  enum_label text;
BEGIN
  SELECT * INTO definition FROM attribute_definition
    WHERE id = NEW.attribute_definition_id FOR SHARE;
  IF NOT FOUND OR definition.state <> 'ACTIVE'
     OR NEW.category_id IS DISTINCT FROM definition.category_id
     OR NEW.value_type IS DISTINCT FROM definition.value_type
     OR NEW.code_snapshot IS DISTINCT FROM definition.code
     OR NEW.label_snapshot IS DISTINCT FROM definition.label
     OR NEW.unit_code_snapshot IS DISTINCT FROM definition.unit_code
     OR NEW.unit_label_snapshot IS DISTINCT FROM definition.unit_label
     OR NEW.filterable_snapshot IS DISTINCT FROM definition.filterable
     OR NEW.searchable_snapshot IS DISTINCT FROM definition.searchable
     OR NEW.comparable_snapshot IS DISTINCT FROM definition.comparable THEN
    RAISE EXCEPTION 'ATTRIBUTE_NOT_APPLICABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.value_type = 'ENUM' THEN
    SELECT option_row.value->>'label' INTO enum_label
      FROM jsonb_array_elements(definition.enum_options) AS option_row(value)
      WHERE option_row.value->>'code' = NEW.enum_code_value;
    IF enum_label IS NULL OR enum_label IS DISTINCT FROM NEW.enum_label_snapshot THEN
      RAISE EXCEPTION 'ATTRIBUTE_VALUE_INVALID' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_attribute_value_snapshot_guard BEFORE INSERT ON product_attribute_value
  FOR EACH ROW EXECUTE FUNCTION catalog_attribute_value_snapshot_guard();

CREATE FUNCTION catalog_reject_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CATALOG_HARD_DELETE_FORBIDDEN' USING ERRCODE = '55000';
END;
$$;
CREATE FUNCTION catalog_reject_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CATALOG_HARD_DELETE_FORBIDDEN' USING ERRCODE = '55000';
END;
$$;
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'brand','category','attribute_definition','catalog_product',
    'catalog_product_revision','product_attribute_value','product_media',
    'product_document_version','product_relation'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION catalog_reject_hard_delete()', table_name || '_no_delete', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION catalog_reject_truncate()', table_name || '_no_truncate', table_name);
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON brand, category, attribute_definition, catalog_product, catalog_product_revision TO stdu_runtime;
GRANT SELECT, INSERT ON product_attribute_value, product_media, product_document_version, product_relation TO stdu_runtime;

-- Append-only R1-004 catalog permission and audit registry extension.
-- Extend the existing immutable validator without changing the frozen R1-002 migration.
-- The cloned legacy body keeps historical actions/values byte-for-byte; the wrapper routes
-- catalog.* actions to this append-only, machine-readable contract extension.
DO $catalog_audit_clone$
DECLARE
  definition text;
  original_definition text;
BEGIN
  SELECT pg_get_functiondef('public.audit_event_valid(text,text,text,jsonb)'::regprocedure)
    INTO original_definition;
  definition := original_definition;
  definition := replace(
    definition,
    'FUNCTION public.audit_event_valid(',
    'FUNCTION public.audit_event_valid_r1_002('
  );
  IF definition NOT LIKE '%FUNCTION public.audit_event_valid_r1_002(%' THEN
    RAISE EXCEPTION 'R1-002 audit validator could not be cloned';
  END IF;
  definition := replace(
    definition,
    $old_permission_codes$'files.metadata.read'
  ];$old_permission_codes$,
    $catalog_permission_codes$'files.metadata.read','catalog.references.read',
    'catalog.products.read','catalog.products.write','catalog.products.submit',
    'catalog.products.publish','catalog.products.archive','catalog.categories.write',
    'catalog.brands.write','catalog.attributes.write','catalog.products.relations.write',
    'catalog.products.media.write','catalog.products.documents.write'
  ];$catalog_permission_codes$
  );
  IF definition = original_definition
     OR definition NOT LIKE '%catalog.products.documents.write%' THEN
    RAISE EXCEPTION 'R1-004 audit permission extension did not match the frozen validator';
  END IF;
  EXECUTE definition;
END;
$catalog_audit_clone$;

CREATE FUNCTION catalog_audit_event_valid(
  p_action text,
  p_outcome text,
  p_reason text,
  p_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_registry jsonb := $catalog_registry${"catalog.reference.changed":{"entityTypes":["Brand","Category","AttributeDefinition"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","CATEGORY_CYCLE","CATEGORY_INACTIVE_PARENT","REFERENCE_IN_USE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["changedFields","version","previousParentId","parentId","previousState","state"]},"catalog.product.created":{"entityTypes":["CatalogProduct"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","IDENTITY_CONFLICT","SLUG_CONFLICT","NOT_FOUND"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","changedFields","version","changeSource"]},"catalog.product.revision.created":{"entityTypes":["CatalogProduct","CatalogProductRevision"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","IDENTITY_CONFLICT","SLUG_CONFLICT","ATTRIBUTE_NOT_APPLICABLE","FILE_NOT_ACCESSIBLE","REFERENCE_IN_USE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","sourceRevisionId","changedFields","version","changeSource"]},"catalog.product.submitted":{"entityTypes":["CatalogProduct","CatalogProductRevision"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION","PUBLICATION_NOT_READY"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","version"]},"catalog.product.reviewed":{"entityTypes":["CatalogProduct","CatalogProductRevision"],"outcomes":{"SUCCESS":["PUBLISHED","RETURN_FOR_CHANGES","REJECTED"],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION","PUBLICATION_NOT_READY","REFERENCE_IN_USE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","decision","reasonCode","version","publishedRevisionId"]},"catalog.product.archived":{"entityTypes":["CatalogProduct"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["previousState","state","publishedRevisionId","pendingRevisionId","version"]},"catalog.product.relations.changed":{"entityTypes":["CatalogProductRevision","ProductRelation"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION","REFERENCE_IN_USE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","addedCount","removedCount","version"]},"catalog.product.media.changed":{"entityTypes":["CatalogProductRevision","ProductMedia"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION","FILE_NOT_ACCESSIBLE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","addedCount","removedCount","version"]},"catalog.product.documents.changed":{"entityTypes":["CatalogProductRevision","ProductDocumentVersion"],"outcomes":{"SUCCESS":[null],"DENIED":["AUTH_REQUIRED","FORBIDDEN","PASSWORD_CHANGE_REQUIRED","ORIGIN_FORBIDDEN","CSRF_INVALID","UNSUPPORTED_MEDIA_TYPE","VALIDATION_ERROR","NOT_FOUND","VERSION_CONFLICT","INVALID_STATE_TRANSITION","FILE_NOT_ACCESSIBLE"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["revisionId","addedCount","removedCount","version"]},"catalog.permissions.initialized":{"entityTypes":["Role"],"actorKinds":["OPERATOR"],"outcomes":{"SUCCESS":["OWNER_APPROVED"],"DENIED":["OWNER_APPROVAL_REQUIRED","INITIAL_GRANT_ALREADY_USED","TARGET_NOT_ELIGIBLE","LAST_ADMIN_REQUIRED","VALIDATION_ERROR"],"FAILURE":["DEPENDENCY_UNAVAILABLE","AUDIT_UNAVAILABLE","INTERNAL_ERROR"]},"changesKeys":["targetUserId","roleId","permissionCodes","approvalReference"],"changesValueConstraints":{"permissionCodes":"Exactly the 12 catalogPermissionCodes pinned by R1-004 0.1.0-proposed; initialization fails closed if registry differs.","approvalReference":"Required non-secret external ticket/reference label, 1..80 characters matching ^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$; recorded as supplied and is not proof of owner approval."}}}$catalog_registry$::jsonb;
  v_action_config jsonb;
  v_outcomes jsonb;
  v_reasons jsonb;
  v_keys text[];
  v_key text;
  v_value jsonb;
  v_expected_permissions jsonb := '["catalog.references.read","catalog.products.read","catalog.products.write","catalog.products.submit","catalog.products.publish","catalog.products.archive","catalog.categories.write","catalog.brands.write","catalog.attributes.write","catalog.products.relations.write","catalog.products.media.write","catalog.products.documents.write"]'::jsonb;
  v_sorted_fields jsonb;
BEGIN
  v_action_config := v_registry -> p_action;
  IF v_action_config IS NULL OR jsonb_typeof(v_action_config) <> 'object' THEN
    RETURN false;
  END IF;
  v_outcomes := v_action_config -> 'outcomes';
  v_reasons := v_outcomes -> p_outcome;
  IF v_reasons IS NULL OR jsonb_typeof(v_reasons) <> 'array' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_reasons) AS allowed(value)
    WHERE (allowed.value = 'null'::jsonb AND p_reason IS NULL)
       OR (jsonb_typeof(allowed.value) = 'string' AND allowed.value #>> '{}' = p_reason)
  ) THEN
    RETURN false;
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' THEN
    RETURN false;
  END IF;
  SELECT array_agg(jsonb_array_elements_text.value)
    INTO v_keys
    FROM jsonb_array_elements_text(v_action_config -> 'changesKeys');
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(p_changes) AS actual(key)
    WHERE NOT (actual.key = ANY(v_keys))
  ) THEN
    RETURN false;
  END IF;
  IF p_action = 'catalog.permissions.initialized' AND p_outcome = 'SUCCESS' AND (
    NOT (p_changes ? 'targetUserId')
    OR NOT (p_changes ? 'roleId')
    OR NOT (p_changes ? 'permissionCodes')
    OR NOT (p_changes ? 'approvalReference')
  ) THEN
    RETURN false;
  END IF;
  IF p_action = 'catalog.permissions.initialized' AND
     p_changes ? 'permissionCodes' AND
     p_changes -> 'permissionCodes' IS DISTINCT FROM v_expected_permissions THEN
    RETURN false;
  END IF;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_changes) LOOP
    CASE
      WHEN v_key = ANY(ARRAY[
        'revisionId','sourceRevisionId','publishedRevisionId','pendingRevisionId',
        'targetUserId','roleId'
      ]) THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
          RETURN false;
        END IF;
      WHEN v_key = ANY(ARRAY['parentId','previousParentId']) THEN
        IF v_value <> 'null'::jsonb AND (
          jsonb_typeof(v_value) <> 'string'
          OR (v_value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ) THEN
          RETURN false;
        END IF;
      WHEN v_key = ANY(ARRAY['version','addedCount','removedCount']) THEN
        IF jsonb_typeof(v_value) <> 'number'
           OR (v_value #>> '{}') !~ '^(0|[1-9][0-9]*)$'
           OR (v_key = 'version' AND (v_value #>> '{}')::numeric < 1)
           OR (v_value #>> '{}')::numeric > 2147483647 THEN
          RETURN false;
        END IF;
      WHEN v_key = 'changedFields' THEN
        IF jsonb_typeof(v_value) <> 'array' OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_value) AS field(item)
          WHERE jsonb_typeof(field.item) <> 'string'
             OR field.item #>> '{}' <> ALL(ARRAY[
               'slug','name','state','parentId','description','sortOrder',
               'categoryId','code','label','valueType','unitCode','unitLabel',
               'enumOptions','filterable','searchable','comparable','brandId',
               'manufacturerName','originalPartNumber','modification',
               'displayName','summary','attributes','relations','media','documents'
             ])
        ) THEN
          RETURN false;
        END IF;
        SELECT COALESCE(jsonb_agg(item ORDER BY item #>> '{}'), '[]'::jsonb)
          INTO v_sorted_fields
          FROM (
            SELECT DISTINCT value AS item
            FROM jsonb_array_elements(v_value)
          ) AS unique_field;
        IF v_value IS DISTINCT FROM v_sorted_fields THEN
          RETURN false;
        END IF;
      WHEN v_key = 'permissionCodes' THEN
        IF v_value IS DISTINCT FROM v_expected_permissions THEN
          RETURN false;
        END IF;
      WHEN v_key = 'approvalReference' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR (v_value #>> '{}') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$' THEN
          RETURN false;
        END IF;
      WHEN v_key = 'decision' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR v_value #>> '{}' NOT IN ('PUBLISH','RETURN_FOR_CHANGES','REJECT') THEN
          RETURN false;
        END IF;
      WHEN v_key = 'reasonCode' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR (v_value #>> '{}') !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
          RETURN false;
        END IF;
      WHEN v_key = 'changeSource' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR v_value #>> '{}' NOT IN ('CREATE','PATCH') THEN
          RETURN false;
        END IF;
      WHEN v_key = ANY(ARRAY['state','previousState']) THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR v_value #>> '{}' NOT IN (
             'ACTIVE','ARCHIVED','DRAFT','PENDING_REVIEW','PUBLISHED',
             'SUPERSEDED','RETURNED','REJECTED','WITHDRAWN'
           ) THEN
          RETURN false;
        END IF;
      ELSE
        RETURN false;
    END CASE;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION audit_event_valid(
  p_action text,
  p_outcome text,
  p_reason text,
  p_changes jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_action LIKE 'catalog.%' THEN
    RETURN catalog_audit_event_valid(p_action, p_outcome, p_reason, p_changes);
  END IF;
  RETURN audit_event_valid_r1_002(p_action, p_outcome, p_reason, p_changes);
END;
$$;

ALTER TABLE audit_event DROP CONSTRAINT audit_event_entity_type_check;
ALTER TABLE audit_event ADD CONSTRAINT audit_event_entity_type_check CHECK (
  entity_type IS NULL OR entity_type IN (
    'StaffUser','Role','StaffSession','SellerLegalEntity','FileObject',
    'FileVersion','FileLink','Brand','Category','AttributeDefinition',
    'CatalogProduct','CatalogProductRevision','ProductAttributeValue',
    'ProductMedia','ProductDocumentVersion','ProductRelation'
  )
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_catalog_initializer_actor_check CHECK (
  action <> 'catalog.permissions.initialized' OR actor_kind = 'OPERATOR'
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_catalog_staff_actor_check CHECK (
  action NOT LIKE 'catalog.%'
  OR action = 'catalog.permissions.initialized'
  OR actor_kind = 'STAFF'
);
ALTER TABLE audit_event ADD CONSTRAINT audit_event_catalog_entity_action_check CHECK (
  action NOT LIKE 'catalog.%' OR COALESCE(CASE action
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
    ELSE false
  END, false)
);

INSERT INTO permission(id,code,description) VALUES
  ('20000000-0000-4000-8000-000000000001', 'catalog.references.read', 'Read active staff catalog brands, categories and attribute definitions.'),
  ('20000000-0000-4000-8000-000000000002', 'catalog.products.read', 'Read internal product roots, editor revisions and publication history; not file bytes or inaccessible file metadata.'),
  ('20000000-0000-4000-8000-000000000003', 'catalog.products.write', 'Create products and append new DRAFT revisions; never submit or publish implicitly.'),
  ('20000000-0000-4000-8000-000000000004', 'catalog.products.submit', 'Submit the current DRAFT revision for a human publication decision.'),
  ('20000000-0000-4000-8000-000000000005', 'catalog.products.publish', 'Publish, return for changes or reject one pending revision; separate from edit and submit.'),
  ('20000000-0000-4000-8000-000000000006', 'catalog.products.archive', 'Archive one product and suppress its public pointer; preserve all revision history.'),
  ('20000000-0000-4000-8000-000000000007', 'catalog.categories.write', 'Create/edit/reparent/archive categories under tree and reference integrity rules.'),
  ('20000000-0000-4000-8000-000000000008', 'catalog.brands.write', 'Create/edit/archive brands under reference integrity rules.'),
  ('20000000-0000-4000-8000-000000000009', 'catalog.attributes.write', 'Create/edit/archive category-specific typed attribute definitions under semantic immutability rules.'),
  ('20000000-0000-4000-8000-000000000010', 'catalog.products.relations.write', 'Replace a product draft''s manually selected accessory/compatible relations.'),
  ('20000000-0000-4000-8000-000000000011', 'catalog.products.media.write', 'Replace draft media metadata referencing an already existing accessible FileVersion; no upload/download.'),
  ('20000000-0000-4000-8000-000000000012', 'catalog.products.documents.write', 'Replace draft document metadata referencing an already existing accessible FileVersion; no upload/download.');


COMMIT;
