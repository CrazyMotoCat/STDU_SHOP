# VIS-CAT-02A — Proposed R1-002 File-Security Amendment

**Status: DRAFT / REVIEW_REQUIRED / NOT FROZEN**

**Scope:** Catalog product-media source and derivative bytes only. This proposal does not edit the frozen R1-002 contract or ADR-004, existing file/download behavior, or runtime code. Before implementation, it requires an owner-approved, versioned ADR-004 exception described below.

## Intent and accepted boundary

MEDIA-01 and MEDIA-02 owner decisions are the basis for this proposal:

- `FileObject` and immutable `FileVersion` remain the only byte and version registry. `ProductMedia` remains the product-revision relation. Do not add a second file registry or a generic public file endpoint.
- Source originals and generated renditions remain private. A narrowly scoped catalog-media route may return a verified generated rendition only after catalog publication and provenance checks. It never returns an original or accepts a FileVersion ID/storage key from a caller.
- Media structural validation is not malware scanning. Keep source and derivative `FileVersion.safetyState = UNCHECKED`; do not label them CLEAN or malware-free. No ClamAV dependency is required by this proposal.
- The media validation approach accepted as the MEDIA-01/02 design basis is proposed here as a narrow exception to ADR-004's general unchecked-file gate. Approval of that ADR-004 exception is still pending; it is not active until an additive ADR-004 amendment and the R1-002 media security amendment are approved and frozen.
- Upload and public delivery remain disabled until the associated contract is approved, frozen, implemented, and enabled deliberately.

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

ADR-004 currently requires selecting and verifying quarantine/scanning before implementing uploads and says unchecked files remain unusable. This proposal does not silently override that rule. It proposes a narrow, versioned exception for a non-executable catalog-raster pipeline, subject to owner approval and contract freeze:

- An original stays `UNCHECKED`, private, and unusable for any preview/download/public response. It is only input to the isolated media processing path.
- A derivative also remains `FileVersion.safetyState = UNCHECKED` and is unusable through all generic file APIs. A separate media-domain verification state, set only by API verification of an isolated full decode/re-encode output and exact rendition manifest, may authorize the dedicated catalog-media route for the exact active published revision.
- The separate state means only `verified under media decode/re-encode policy version N`; it does not mean scanned, malware-free, or generally safe to download. Only allowlisted raster derivative bytes are served, and only from the narrow media route.
- If the owner does not approve this versioned exception, or implementation cannot provide the isolated verifier and origin checks below, uploads and public media remain disabled until a scanner/quarantine policy that satisfies ADR-004 is separately selected and verified.

This keeps the approved generic R1-002 file policy intact while making the requested media-specific exception explicit and reviewable.

## Quarantine, temporary bytes, and processing boundary

The future ingestion implementation must:

1. Authenticate the staff actor, authorize the exact target product, enforce upload limits before writing, and generate every storage key and temporary path server-side.
2. Persist the exact source and temporary object keys plus a monotonic fencing generation in `CatalogMediaStorageIntent` before writing. Stream the accepted source into a product-scoped media quarantine namespace, using bounded per-operation staging in the private volume. Never write to a web-served directory, shared arbitrary temp path, or worker-mounted storage.
3. Accept only a documented single-frame raster input profile. The initial candidate is JPEG, PNG, and WebP; reject SVG, animation, unsupported formats, malformed/truncated streams, and signature/MIME disagreement. A codec must fully decode the source before any output is considered.
4. Normalize orientation, produce a bounded fixed WebP rendition set, and remove EXIF/GPS, XMP, IPTC, comments, embedded thumbnails, and other carried metadata. Preserve equipment markings and proportions: do not upscale, crop, watermark, or claim exact color fidelity without explicit policy.
5. Keep originals and derivatives private and never serve the original. A failed, timed-out, stale, or partially verified attempt cannot make a public pointer READY. Full decode of worker-produced bytes runs in a separate constrained verifier process with no database/storage credentials; the privileged API accepts only the verifier's bounded measured result and still checks digests, lengths, allowed variant, profile, and source/job identity.

This structural decode/re-encode policy proves only that the accepted image profile was decoded and generated under the recorded policy version. It does not prove absence of malware, hidden/polyglot content, ownership, or legal rights.

## Storage intent and reconciliation proposal

The current StoragePort is not a media upload/reconciliation contract. Add a narrowly scoped media storage adapter in a future implementation, not arbitrary path methods on a generic API. Before physical writes, persist a `CatalogMediaStorageIntent` containing opaque server-generated staging and final keys, namespace, nullable digest/actual byte count until the stream completes, artifact kind, owner ingestion/job, timestamps, monotonic fencing generation, lease owner/expiry, and bounded state (`RESERVED`, `WRITING`, `COMMITTED`, `ABANDONED`). An untrusted declared length is only an early cap, never the persisted verified size. Staging is a media-owned area in the private volume and never receives a FileVersion row. Stream and hash to staging, verify limits, then fsync the file and its staging directory; atomically rename within the same volume, fsync the final directory, and insert the immutable FileVersion plus commit the intent in one database transaction that checks the current fencing generation. If the filesystem cannot provide these durability/atomicity guarantees, leave the feature disabled and use an explicitly reviewed recovery design.

Crash and reconciliation rules:

- Enumerate only media-owned staging, `CATALOG_MEDIA_SOURCE`, and `CATALOG_MEDIA_DERIVATIVE` through a bounded cursor. Never scan or clean `DEFAULT`, inquiry quarantine, or another task's storage.
- Compare exact `(namespace, storageKey)` and expected digest/size to FileVersion rows and active intents. Reconciliation atomically locks the intent and fences out its current writer by advancing the generation and marking the old generation abandoned. Every write/promotion and database commit rechecks the live generation and lease. A stale writer may leave an orphan but cannot commit or overwrite a newer generation. Delete an exact unreferenced object only after the fence is committed, the configured grace expires, and no active generation references its key; process bounded batches and emit a sanitized event.
- Persist and enumerate temporary staging keys as well as permanent media keys so crashes before promotion are recoverable. Cleanup may remove only an exact staging key owned by a fenced/expired media intent; never run a generic temporary-directory sweep. The file and containing directory must be synced before a database reference can commit, and final directory changes must be synced before marking the intent committed.
- Never delete a FileVersion or its bytes merely because a ProductMedia relation was replaced, a revision was superseded, or the product was archived. Source retention and legal hold policy still apply.
- A DB-referenced but missing or checksum-mismatched object marks the rendition set `UNAVAILABLE`, blocks public delivery, and raises an operational alert. Do not silently fall back to a source, older generation, or different image.
- Cleanup must be restart-safe and idempotent. Reconciliation must not infer ownership from directory names or user-provided identifiers.

Candidate storage methods are limited to reserve/write exact server-owned object using a current fencing token, open exact namespace/key for a permitted media job, list one allowlisted namespace with cursor/limit, and delete one exact unreferenced key with expected digest after an atomic fenced-intent check. No caller supplies a filesystem path.

## Worker isolation and fail-closed output validation

The worker receives only a bounded byte stream and non-secret job metadata. It receives no database credentials, storage key, FileVersion ID, filesystem mount, public origin, arbitrary URL, application secret, or general storage access. It has no egress, host port, shell, root privileges, writable root filesystem, or Linux capabilities; use a read-only runtime, bounded scratch space, CPU/memory/process/time limits, patched codecs, and an explicit host/network egress-deny verification. The worker is reachable only over a private media network shared by the API and worker; no other container is attached and no host port is published. The output verifier runs non-root with a read-only filesystem, no network/host mounts/capabilities/credentials, bounded private scratch and pipe I/O, an OS sandbox/seccomp profile, and hard CPU/memory/PID/wall limits. The verifier receives one output stream and returns bounded measurements only. Verify these isolation properties at the host/runtime layer; a Docker bridge by itself is not evidence of denied egress or API-only ingress.

The API remains the trust boundary: it independently verifies byte count, SHA-256, declared signature, variant completeness, policy/profile and source/job identity. A separate constrained verifier process, without database/storage credentials, fully decodes each returned WebP, measures dimensions/frame count, and verifies metadata stripping under its own resource limits; do not run a complex image decoder in the privileged NestJS process. The API checks the verifier result against the exact bytes it stores and writes validated outputs itself. The worker cannot set READY, publish, attach, revoke, or write audit as a staff member. Duplicate or stale attempt results are rejected by exact job/attempt/source-digest identity.

Retries are idempotent for the same job ID, source digest, profile, and policy. The same job ID with a different body/manifest is a conflict. A retry after a changed source or processing profile gets a new attempt and rendition-set generation. No response loss can attach an unverified output or create duplicate active assets.

## Audit, retention, and feature gates

Use the existing human actor for staff upload, provenance confirmation, replacement, publication workflow, and revocation. Audit only finite event codes, target product/asset identifiers, job/result codes, and bounded rendition counts. Do not include filenames, raw bytes, paths, storage keys, source URLs, rights evidence text, or PII.

Current R1-002 audit actor kinds are `STAFF`, `ANONYMOUS`, and `OPERATOR`. A system worker completion event cannot be attributed to the uploader. A narrow `SYSTEM` actor kind for media processing/availability events is a **pending owner decision** requiring a versioned R1-002 audit amendment, actor constraints, and finite action registry. Until approved, do not invent or impersonate an actor kind; implementation must use an approved service-event mechanism or remain disabled.

No production upload, media processing, public bytes, new role grants, or deployment is authorized by this draft. The feature defaults to disabled; a missing/invalid policy, storage namespace, worker isolation check, or publication relation fails closed.

## Cross references

- [R1-004 media model amendment](VIS-CAT-02A-R1-004-product-media-amendment.md)
- [Public API and worker protocol](VIS-CAT-02A-public-api-worker-protocol.md)
- [Review, benchmark, and implementation sequence](VIS-CAT-02A-review-and-benchmark-roadmap.md)
