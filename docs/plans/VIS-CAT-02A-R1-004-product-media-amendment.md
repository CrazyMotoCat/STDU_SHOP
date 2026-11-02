# VIS-CAT-02A — Proposed R1-004 Product-Media Amendment

**Status: DRAFT / REVIEW_REQUIRED / NOT FROZEN**

**Extends:** R1-004 catalog contracts additively, subject to owner approval. No frozen artifact is edited by this proposal.

## Contract goals and invariants

Owner-approved MEDIA-01–06 authorize design work only. Preserve the existing `CatalogProduct` / immutable `CatalogProductRevision` publication lifecycle, OCC, submit/review gates, RBAC, and audit. Media upload, processing, publication, and delivery are separate actions. Media readiness never publishes a product or changes its revision state.

Keep `FileObject` / `FileVersion` as the only source/derivative byte registry and `ProductMedia` as the revision-owned presentation relation. Do not create a second asset/file store. A source belongs to exactly one product; revisions of that product may refer to that logical image and one exact verified rendition set. Cross-product reuse is denied.

## Proposed additive records

Names and fields below are proposals for review, not migration instructions.

### `CatalogMediaIngestion`

One logical image/source for one product. Fields: opaque random UUID `id`; `targetProductId`; `sourceFileVersionId` (nullable only in the atomic `RECEIVING` reservation state, required before `QUARANTINED`); stable random `publicAssetId` (non-capability, generated once, unique within the product and never reused); source digest/byte count; lifecycle; uploader staff ID and timestamp; durable actor-scoped idempotency key, canonical request hash and replay result identity; revocation actor/time/reason code; created/updated timestamps. The source FileVersion is in `CATALOG_MEDIA_SOURCE`, its FileObject is `PRIVATE`, and its `safetyState` remains `UNCHECKED`.

Unique rules: `(targetProductId, publicAssetId)`, global unique non-null `sourceFileVersionId` so one immutable source cannot be claimed by two products, and `(actorStaffUserId, idempotencyKey)` so one actor's key cannot be reused for another product. Reserve the actor/key, requested target product, generated ingestion ID, `RECEIVING` state, and request hash seed atomically before bytes are written. Compute the canonical full request hash while streaming; when the same key is already receiving, return a bounded in-progress response without creating or processing another object. Once the hash/result is persisted, same-body retries return the same safe result; changed body or target returns conflict. Also provide unique referenced composites suitable for exact foreign keys. Never use the public ID as permission or proof of publication.

Suggested lifecycle: `RECEIVING -> QUARANTINED -> PROCESSING -> READY`, with terminal `REJECTED` and `REVOKED`, and recoverable `FAILED_RETRYABLE` / `UNAVAILABLE`. `sourceFileVersionId` must be non-null by `QUARANTINED`. Revoke is terminal for every rendition generation of that ingestion. A correction/new source creates a new ingestion and public asset ID.

### `CatalogMediaProcessingAttempt`

Immutable attempt identity with mutable lease/result state: `id`, `ingestionId`, globally opaque `jobId`, monotonically increasing `attemptNo`, source digest, profile and media-policy versions, worker build ID, state, hash of the single-use request nonce, nonce expiry/consumed timestamp, start/finish timestamps, bounded failure code, and manifest digest when returned. Uniqueness on `(ingestionId, attemptNo)` and `jobId`. A stale, replayed, expired, or mismatched response cannot replace a newer attempt's output.

### `CatalogMediaRenditionSet` and `CatalogMediaRendition`

Each accepted processing generation has one immutable `renditionSetId`, ingestion/source identity, source digest, profile version, policy version, manifest digest, state, verification timestamp, and ready timestamp. A READY set contains exactly the required variant set, enforced by a unique `(renditionSetId, variant)` key and one transaction that checks the selected profile's exact required variant inventory before READY. Output records are immutable and point to exact derivative FileVersions whose FileObjects must remain `PRIVATE` and eligible. Enforce this with a database constraint/composite discriminator where supported and repeat it in transactional finalization and public-read predicates. A `VERIFIED_MEDIA_POLICY` state belongs to the rendition set, not generic FileVersion `safetyState`; it records the precise isolated decode/re-encode verification policy and never means malware-scanned or CLEAN.

Initial variant/profile candidates (final values require benchmark): `THUMBNAIL` 320 px, `CARD` 480 px, `MAIN` 1600 px, `LARGE` 2048 px; all are WebP, preserve aspect ratio, do not upscale, and use fixed quality/color/metadata policy versions. Each rendition records width, height, encoded byte count, SHA-256, variant, and derivative FileVersion. Each derivative FileVersion uses `CATALOG_MEDIA_DERIVATIVE`, a private FileObject, and `safetyState=UNCHECKED`.

Database integrity should enforce namespace, product, source, and generation binding with composite unique keys/FKs where PostgreSQL permits. If a constant namespace cannot be enforced through a composite FK, use an explicit checked discriminator on the relation plus a transactional service invariant and a dedicated constraint test. `CatalogMediaRenditionSet` must belong to the same ingestion/product/source as its renditions and ProductMedia relation. Every source and derivative FileObject remains `PRIVATE` and in an eligible state; enforce this with a checked discriminator/constraint where possible and recheck transactionally before READY and public reads. Never weaken the FileObject owner policy for generic file access to satisfy this typed media relationship.

### `CatalogMediaStorageIntent`

Durable reservation/reconciliation record for source and derivative writes, as specified in [the R1-002 amendment](VIS-CAT-02A-R1-002-file-security-amendment.md). It is not a second file record and contains no caller-supplied path. A source upload reserves its ingestion and intent before streaming to staging; actual digest and byte count are recorded only after the stream completes and are checked before final promotion.

## `ProductMedia` revision binding

Retain all current fields and meaning: `productRevisionId`, source `fileVersionId`, `altText`, `caption`, `sortOrder`, `isPrimary`, `createdByUserId`, `createdAt`. Add proposed `productId`, `catalogMediaIngestionId`, and exact `renditionSetId` (nullable only for legacy rows during an explicitly reviewed transition). The source FileVersion remains the current `fileVersionId`; it must equal the ingestion source. The rendition set must belong to that ingestion, product, and source.

Add provenance/rights and identity-confirmation fields on the revision relation:

- `sourceType`: controlled `INTERNAL`, `MANUFACTURER`, `SUPPLIER`, or `OTHER` value;
- `sourceReference`: bounded internal reference or source URL recorded as data only; never fetch it automatically;
- `rightsBasis`, `rightsEvidenceReference`, bounded `rightsRestrictions`, optional `requiredAttribution`;
- `rightsVerifiedByUserId` and `rightsVerifiedAt`;
- `productMatchIdentityHash`, exact `productMatchRenditionSetId` and `productMatchManifestSha256`, plus `productMatchConfirmedByUserId` and `productMatchConfirmedAt`.

For a third-party image, require an internal license/permission evidence reference and an explicit rights basis before submit/publish. A URL or attribution is not proof of permission. No external search/import, brand promotion, partnership claim, or legal assurance is created here. Human verification is an attestation, not a guarantee that rights are legally sufficient.

Product match means the staff member confirmed that the exact displayed rendition set depicts the exact manufacturer/model/part/modification tuple of the revision. Use the existing R1-004 identity normalization: `brandId`, `manufacturerName`, `originalPartNumber`, and `modification` (including existing null/normalization rules). Compute a versioned canonical encoding and SHA-256 on the server. Bind confirmation to that identity hash, exact `renditionSetId`, and manifest digest. At submit and publish, lock/re-read the exact revision and rendition set and recompute/recompare all three values; reject if any differs. Reprocessing that creates a new set or manifest clears the match confirmation even if the source is unchanged. Never infer a match from OCR, filename, metadata, brand, or similarity.

Suggested composite integrity:

- `(productRevisionId, productId) -> CatalogProductRevision(id, productId)`;
- `(catalogMediaIngestionId, fileVersionId, productId) -> CatalogMediaIngestion(id, sourceFileVersionId, targetProductId)`;
- `(renditionSetId, catalogMediaIngestionId, fileVersionId, productId) -> CatalogMediaRenditionSet(id, ingestionId, sourceFileVersionId, targetProductId)`.

The global unique source constraint plus relational keys make cross-product source reuse, wrong-source, wrong-revision, and stale-generation attachment impossible even if a service check is accidentally omitted. Keep existing order/primary uniqueness. A ProductMedia relation is immutable with its revision under existing R1-004 rules.

## Revision lifecycle and publication gates

- Upload does not add ProductMedia to a revision. Explicit staff metadata replacement attaches a READY ingestion and exact READY rendition set to the current DRAFT under existing `catalog.products.media.write` and expected-version/base-revision checks.
- New DRAFT copied from a previous revision may preserve the same ingestion, source, rendition set, and unchanged rights evidence. Reset product-match confirmation and require confirmation against the new exact revision identity and exact rendition set/manifest. Any change of source, rendition set/manifest, rights basis/evidence, restrictions, attribution, or target product clears the relevant confirmation.
- Before submit/review/publication, verify source/set/revision/product match, source/derivative namespace, private FileObject visibility/state, `READY` and `VERIFIED_MEDIA_POLICY` availability, exact profile-required variants and checksums, active product/category/brand conditions from R1-004, rights evidence/attestation, exact identity hash plus confirmed rendition-set/manifest binding, and no ingestion revocation. Fail closed and never auto-publish.
- Product unpublish, archive, or pointer change immediately denies new origin requests for the old relation. A media revoke blocks every revision and generation using that ingestion. Already downloaded bytes and browser/proxy caches cannot be recalled instantly.
- Legacy ProductMedia rows with no ingestion/provenance are not silently upgraded or published as media-enabled. Use an explicit human re-ingest/review/detach workflow; no automatic backfill guesses provenance or rights.

## RBAC and audit proposal

Keep action RBAC default-deny and the current one-business authorization model. Action permission plus service-level exact product target checks is not a new row-level role or staff ownership model. Propose the following narrowly scoped additions; no existing role/bootstrap permission is granted automatically:

| Permission                       | Purpose                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `catalog.products.media.upload`  | Upload one source and request/retry its processing for an explicitly authorized product. Processing cannot attach or publish.                                |
| `catalog.products.media.read`    | Read typed product-media relation, status, and provenance needed by authorized catalog editors/reviewers; never generic FileObject metadata or source bytes. |
| `catalog.products.media.preview` | Preview a verified private derivative in staff context.                                                                                                      |
| `catalog.products.media.revoke`  | Revoke a logical ingestion and block every generation.                                                                                                       |

Staff media relation, ingestion state, and provenance reads require both `catalog.products.read` and `catalog.products.media.read`; staff previews require both `catalog.products.read` and `catalog.products.media.preview`. Upload/process and revoke require the corresponding media action plus the exact product-target check. Existing `catalog.products.media.write` remains required for draft attachment/replacement and provenance metadata changes; `catalog.products.publish` remains the separate publication gate. The typed media actions do not depend on who originally uploaded the private FileObject. Do not broaden or bypass generic `files.metadata.read` / FileObject ownership policies; those continue to govern generic file metadata and ProductDocument. The versioned catalog-media routes use the typed product-media policy and never expose generic file metadata or source bytes. No existing permission or bootstrap role is auto-granted. Public delivery uses no staff permission; its domain publication predicate is not generic file ACL.

Audit `catalog.product.media.changed` remains for draft relation changes. Propose finite additions `catalog.product.media.uploaded`, `.processed`, `.provenance.verified`, `.revoked`, and `.availability.changed`, with bounded result codes. Processing actor kind is unresolved pending the R1-002 amendment; never attribute worker work to the uploader.

## Public revision behavior

Public product DTOs expose only presentation data and fixed same-origin hrefs. Card response adds an optional nullable `primaryImage?: null | PublicProductImage`; detail response adds an optional ordered `images?: PublicProductImage[]`. Each entry may contain stable non-capability `assetId`, `renditionSetId`, alt text, actual width/height/aspect ratio, fixed variant paths/sizes, and `image/webp`. New servers may return `null`/an empty list when no eligible media exists. Never expose FileObject/FileVersion IDs, source filename, storage namespace/key, rights/source/evidence, staff IDs, audit data, or worker details.

Public hrefs identify one immutable rendition generation. The origin checks the current published revision before returning bytes, so old-generation URLs fail after the current ProductMedia set changes. Keep IDs opaque and never reusable. Public image route contract and error behavior are defined in [the API/worker protocol](VIS-CAT-02A-public-api-worker-protocol.md).

## Compatibility and freeze boundary

This proposal requires a versioned R1-004 amendment and generated OpenAPI/client update only after owner approval. It replaces `files.metadata.read`/generic FileObject object-policy checks only on typed catalog-media metadata/preview routes with `catalog.products.media.read` / `.preview` plus `catalog.products.read` and exact product checks; generic file metadata, original bytes, and ProductDocument retain the frozen policy. Existing card/detail OpenAPI schemas use `additionalProperties: false`; adding image fields to those responses may break strict consumers. Before any response change, publish the updated OpenAPI/generated clients to all known consumers and verify they tolerate the optional fields. If the consumer inventory is incomplete or a strict older consumer must remain compatible, add versioned public card/detail routes instead of changing the existing V1 response. The current public API remains image-free until that compatibility gate and a separately approved implementation stage pass. This draft does not modify `R1-004-catalog-data-model.json`, Prisma, existing OpenAPI, permissions, role grants, or public DTOs now.
