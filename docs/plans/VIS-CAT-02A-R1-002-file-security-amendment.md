# VIS-CAT-02A — Proposed R1-002 File-Security Amendment

**Status: DRAFT / REVIEW_REQUIRED / NOT FROZEN**

**Scope:** Catalog product-media source and derivative bytes only. This proposal does not edit the frozen R1-002 contract or ADR-004, existing file/download behavior, or runtime code. Before implementation, it requires an owner-approved, versioned ADR-004 exception described below.

## Decision provenance and design boundary

The earlier `VIS-CAT-02 OWNER REVIEW / Decision Proposal + VIS-CAT-02A Contract Preparation` explicitly says it is for owner approval and that none of its policies are approved until confirmed. Its `MEDIA-01`–`MEDIA-06` labels therefore do not establish blanket approval. The later owner response accepts architecture A as the basis for further design and gives the narrower directions OD-MEDIA-07–14; the decision register and evidence status are recorded in [the review roadmap](VIS-CAT-02A-review-and-benchmark-roadmap.md). Nothing here is frozen.

- The accepted design basis keeps `FileObject` / immutable `FileVersion` as the byte registry and `ProductMedia` as the product-revision relation. Do not add a second byte registry or generic public file endpoint.
- OD-MEDIA-07 selects the target exception semantics: the original stays private and `UNCHECKED`; only a generated WebP derivative may be served through the media-specific route after isolated decode/re-encode and independent verification. R1-010D `CLEAN` is not an authorization predicate. The exception remains inactive pending a concrete versioned ADR-004 amendment, isolation evidence, and security acceptance.
- Structural image verification is not malware scanning and proves no malware-free property. Whether an additional scanner is needed remains outside the approved direction and requires separate evidence/decision; do not infer either a mandatory ClamAV requirement or a general exemption from scanning from the earlier proposal.
- Upload, processing, attachment, and public delivery remain disabled until their exact amendments are reviewed, approved, frozen, implemented, and deliberately enabled.

## Additive FileVersion classification

Propose an additive `storageNamespace` closed enum on `FileVersion`:

| Value                      | Use                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DEFAULT`                  | Every existing FileVersion and existing non-media use. Backfill existing rows to this value without moving bytes. |
| `CATALOG_MEDIA_SOURCE`     | Immutable uploaded source bytes in private quarantine/storage.                                                    |
| `CATALOG_MEDIA_DERIVATIVE` | Immutable server-generated WebP renditions.                                                                       |

Keep `storageKey` opaque and globally unique. It is never a URL, public DTO field, worker input, log field, or caller-controlled path. Media `FileObject.visibility` is always `PRIVATE`. `DEFAULT` remains the default for old and future non-media records. The namespace is a server-side storage boundary, not an authorization grant.

No static/public volume mount is added. The existing ADR-004 `private-files` volume remains mounted only in NestJS. Generic FileVersion download routes continue to deny source and derivative bytes, regardless of `safetyState` or staff metadata access. Public rendition access is a typed media-domain exception in NestJS and cannot be reached through a generic file API.

## Proposed versioned ADR-004 exception

ADR-004 currently requires selecting and verifying quarantine/scanning before implementing uploads and says unchecked files remain unusable. OD-MEDIA-07 selects the intended narrow exception semantics but does not activate or freeze an exception. A versioned amendment for the non-executable catalog-raster pipeline is still required:

- An original stays `UNCHECKED`, private, and unusable for any preview/download/public response. It is only input to the isolated media processing path.
- A derivative also remains `FileVersion.safetyState = UNCHECKED`. A separate media-domain verification state records API verification of the isolated decode/re-encode output and exact manifest. Public delivery additionally requires the exact active published revision. The approved amendment would need to explicitly cover typed Staff preview of verified derivatives with exact product and permission checks. Generic file APIs and original bytes remain outside both exceptions.
- The separate state means only `verified under media decode/re-encode policy version N`; it does not mean scanned, malware-free, or generally safe to download. Only allowlisted raster derivative bytes are served, and only from the narrow media route.
- If the owner does not approve this versioned exception, or implementation cannot provide the isolated verifier and origin checks below, uploads and public media remain disabled until a scanner/quarantine policy that satisfies ADR-004 is separately selected and verified.

This preserves the existing generic R1-002 policy. No generic file behavior changes; the media exception stays inactive until its exact text and security acceptance are approved.

## Quarantine, temporary bytes, and processing boundary

The future ingestion implementation must:

1. Authenticate the staff actor, authorize the exact target product, enforce upload limits before writing, and generate every storage key and temporary path server-side.
2. Persist the exact source and temporary object keys plus a monotonic fencing generation in `CatalogMediaStorageIntent` before writing. Stream the accepted source into a product-scoped media quarantine namespace, using bounded per-operation staging in the private volume. Never write to a web-served directory, shared arbitrary temp path, or worker-mounted storage.
3. Accept only a documented single-frame raster input profile. The initial candidate is JPEG, PNG, and WebP; reject SVG, animation, unsupported formats, malformed/truncated streams, and signature/MIME disagreement. A codec must fully decode the source before any output is considered.
4. Normalize orientation, produce a bounded fixed WebP rendition set, and remove EXIF/GPS, XMP, IPTC, comments, embedded thumbnails, and other carried metadata. Preserve equipment markings and proportions: do not upscale, crop, watermark, or claim exact color fidelity without explicit policy.
5. Keep originals and derivatives private and never serve the original. A failed, timed-out, stale, or partially verified attempt cannot make a public pointer READY. Full decode of worker-produced bytes runs in a separate constrained verifier process with no database/storage credentials; the privileged API accepts only the verifier's bounded measured result and still checks digests, lengths, allowed variant, profile, and source/job identity.

This structural decode/re-encode policy proves only that the accepted image profile was decoded and generated under the recorded policy version. It does not prove absence of malware, hidden/polyglot content, ownership, or legal rights.

## Storage intent and reconciliation proposal

The current StoragePort is not a media upload/reconciliation contract. Add a narrowly scoped media storage adapter in a future implementation, not arbitrary path methods on a generic API. Before physical writes, persist a `CatalogMediaStorageIntent` containing opaque server-generated staging and final keys, namespace, nullable digest/actual byte count until the stream completes, artifact kind, owner ingestion/job, timestamps, monotonic fencing generation, lease owner/expiry, and bounded state (`RESERVED`, `WRITING`, `COMMITTED`, `ABANDONED`). An untrusted declared length is only an early cap, never the persisted verified size. Staging is a media-owned area in the private volume and never receives a FileVersion row. Stream and hash to staging, verify limits, synchronize the file and staging-directory entry; atomically install the immutable generation-specific final key without replacement on the same filesystem; synchronize both source and destination parent directories when distinct; then insert the immutable FileVersion plus commit the intent in one short database transaction that checks the current fencing generation. If the filesystem cannot provide these durability/atomicity guarantees, leave the feature disabled and use an explicitly reviewed recovery design.

Crash and reconciliation rules:

- Enumerate only media-owned staging, `CATALOG_MEDIA_SOURCE`, and `CATALOG_MEDIA_DERIVATIVE` through a bounded cursor. Never scan or clean `DEFAULT`, inquiry quarantine, or another task's storage.
- Compare exact `(namespace, storageKey)` and expected digest/size to FileVersion rows and active intents. Reconciliation atomically locks the intent and fences out its current writer by advancing the generation and marking the old generation abandoned. Every write/promotion and database commit rechecks the live generation and lease. A stale writer may leave an orphan but cannot commit or overwrite a newer generation. Delete an exact unreferenced object only after the fence is committed, the configured grace expires, no active generation references its key, and writer quiescence is proven by the hard operation deadline plus supervisor/process termination. A grace delay alone is not proof; if quiescence cannot be established, defer deletion and retry reconciliation. Process bounded batches and emit a sanitized event.
- Persist and enumerate temporary staging keys as well as permanent media keys so crashes before promotion are recoverable. Cleanup may remove only an exact staging key owned by a fenced/expired media intent; never run a generic temporary-directory sweep. The file and containing directory must be synced before a database reference can commit, and final directory changes must be synced before marking the intent committed.
- Never delete a FileVersion or its bytes merely because a ProductMedia relation was replaced, a revision was superseded, or the product was archived. Source retention and legal hold policy still apply.
- Missing or checksum-mismatched bytes block delivery and raise an operational alert. The request does not mutate published revisions. A separately authorized state transition may mark the rendition set `UNAVAILABLE`. Do not fall back to a source, older generation, or different image.
- Cleanup must be restart-safe and idempotent. Reconciliation must not infer ownership from directory names or user-provided identifiers.

Candidate storage methods are limited to reserve/write exact server-owned object using a current fencing token, open exact namespace/key for a permitted media job, list one allowlisted namespace with cursor/limit, and delete one exact unreferenced key with expected digest after an atomic fenced-intent check. No caller supplies a filesystem path.

### Filesystem capability gate

The repository does not establish which host filesystem backs the production Docker named volume. `infra/compose/compose.yaml` declares `private-files:/data/files`, but that does not prove the host mount's crash semantics. The current `apps/api/src/storage/private-file-storage.ts` writes an exclusive temporary file and calls `rename`; it does not demonstrate file or directory `fsync`, a no-replace promotion guarantee, or the media recovery protocol. Do not treat that adapter as proof that the proposed guarantees already exist.

Before enabling the storage amendment, close the target-mount evidence gaps in [the roadmap](VIS-CAT-02A-review-and-benchmark-roadmap.md). Prove same-filesystem staging and final objects, traversal and symlink rejection, atomic no-replace promotion, file and relevant directory sync before a database reference, and immutable final objects. Keep storage I/O outside long database transactions. Record the tested filesystem, mount and failure model. If the target cannot provide the guarantees, keep media processing disabled pending a reviewed recovery design.

The minimum crash invariant is that a committed `FileVersion` points only to durably installed bytes. Recovery after a lost COMMIT response resolves the exact persisted outcome before any retry or cleanup.

## Worker isolation and fail-closed output validation

The worker receives a bounded byte stream and non-secret job metadata. Deny database and storage credentials, storage keys, FileVersion IDs, host mounts, arbitrary URLs, egress, host ports, root privileges, writable root and capabilities. Use patched codecs and hard CPU, memory, PID, scratch and wall limits. The verifier also runs non-root with read-only root, bounded I/O and OS sandboxing, and receives only the exact staged output bytes and job context. The [API/worker protocol](VIS-CAT-02A-public-api-worker-protocol.md) separates the no-network proof from the connected HTTP candidate and defines the required trust boundaries.

The API remains the trust boundary: it independently verifies byte count, SHA-256, declared signature, variant completeness, policy/profile and source/job identity. A separate constrained verifier process, without database/storage credentials, fully decodes each returned WebP, measures dimensions/frame count, and verifies metadata stripping under its own resource limits; do not run a complex image decoder in the privileged NestJS process. The API checks the verifier result against the exact bytes it stores and writes validated outputs itself. The worker cannot set READY, publish, attach, revoke, or write audit as a staff member. Duplicate or stale attempt results are rejected by exact job/attempt/source-digest identity.

Retries are idempotent for the same job ID, source digest, profile, and policy. The same job ID with a different body/manifest is a conflict. A retry after a changed source or processing profile gets a new attempt and rendition-set generation. No response loss can attach an unverified output or create duplicate active assets.

## Audit, retention, and feature gates

Use the existing human actor for staff upload, provenance confirmation, replacement, publication workflow, and revocation. Audit only finite event codes, target product/asset identifiers, job/result codes, and bounded rendition counts. Do not include filenames, raw bytes, paths, storage keys, source URLs, rights evidence text, or PII.

Current R1-002 audit actor kinds are `STAFF`, `ANONYMOUS`, and `OPERATOR` (`docs/contracts/R1-002-data-model.json`). OD-MEDIA-08 authorizes designing a narrow `SYSTEM` actor for media processing/availability events; it does not add `SYSTEM` to the frozen registry or authorize implementation. The versioned amendment must require null staff-user and operator-label fields, allow only the following proposed actions, and deny ProductRevision mutation or file-delivery authority:

| Proposed registered action                   | Exact target and required correlation                                                            | Bounded change values / outcomes                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.product.media.processed`            | `CatalogMediaProcessingAttempt` / exact attempt ID; required `jobId` and `attemptNo`.            | `resultCode` only from `VERIFIED`, `UNSUPPORTED_INPUT`, `DECODE_REJECTED`, `LIMIT_EXCEEDED`, `PROCESSING_TIMEOUT`, `WORKER_UNAVAILABLE`, `OUTPUT_INVALID`, `STALE_ATTEMPT`; optional exact `renditionSetId`. `SUCCESS` is allowed only for `VERIFIED` with null reason; `FAILURE` is allowed only for the listed failure code as reason; `DENIED` is forbidden. |
| `catalog.product.media.availability.changed` | Exact media job/attempt that produced the availability change; required `jobId` and `attemptNo`. | `previousAvailability`/`availability` only from `AVAILABLE`/`UNAVAILABLE`; `reasonCode` only from `OBJECT_MISSING`, `BYTE_COUNT_MISMATCH`, `DIGEST_MISMATCH`, `VERIFIED_AGAIN`. Only a persisted state change is `SUCCESS` with null audit reason; `DENIED`/`FAILURE` are forbidden.                                                                            |

Only the trusted API orchestrator may emit a registered result after validating the exact attempt; the worker supplies neither an actor kind nor an arbitrary audit event. If an availability observation has no persisted job/attempt context, do not emit a SYSTEM audit event for it; use sanitized operational telemetry or propose a separately approved attempt model. No PII, source text, storage key/path, rights evidence, or arbitrary actor label is recorded. Until this amendment and matching R1-004 audit constraints are approved and frozen, SYSTEM media events remain disabled.

No production upload, media processing, public bytes, new role grants, or deployment is authorized by this draft. The feature defaults to disabled; a missing/invalid policy, storage namespace, worker isolation check, or publication relation fails closed.

## Cross references

- [R1-004 media model amendment](VIS-CAT-02A-R1-004-product-media-amendment.md)
- [Public API and worker protocol](VIS-CAT-02A-public-api-worker-protocol.md)
- [Review, benchmark, and implementation sequence](VIS-CAT-02A-review-and-benchmark-roadmap.md)
