# VIS-CAT-02A — Review, Benchmark, Acceptance, and Sequencing

**Status: DRAFT / REVIEW_REQUIRED / NOT FROZEN**

**Task:** VIS-CAT-02A contract proposal only. No runtime, migration, infrastructure, or production operation is included.

## Scope and non-goals

This packet proposes amendments to frozen R1-002 file security and R1-004 product catalog contracts after the owner approved MEDIA-01–06 for design. It does not freeze those amendments or authorize implementation. It does not modify PR #36, R1-010D, QUALITY work, R1-006B, other agent worktrees, Docker, database state, roles, public catalog behavior, or production flags.

No automatic external image search/import, brand/model inference, AI-generated substitute image, antivirus claim, customer marketplace, rights/legal guarantee, auto-publish, client-side direct storage, generic FileVersion download, public original, arbitrary image proxy, CDN/purge, or new third-party service is proposed.

## Independent read-only review assignments

Before finalizing this draft packet, perform three separate read-only passes and report findings against its exact commit:

1. **Data model/PostgreSQL + infrastructure:** relational keys, namespace integrity, revision/OCC/publication races, storage-intent crash consistency, reconciliation scope, current topology assumptions.
2. **Application security + file storage:** upload/quarantine, decoder/worker boundary, resource abuse, IDOR/traversal, cache/revoke, origin behavior, audit and privacy.
3. **API/OpenAPI + frontend:** DTO minimization, route/proxy semantics, status/error distinctions, client compatibility, image loading/SSR/accessibility, no accidental public feature enablement.

Reviewers are read-only. They must not edit shared/frozen contracts or runtime files. Record blocking/nonblocking findings, evidence location, and disposition; do not treat a reviewer PASS as owner approval or a frozen contract.

## Benchmark candidates only

The following are starting values, not accepted limits. A measured result and independent infrastructure review are required before contract freeze. R1-010D resource limits or CI container capacity do not establish target VDS capacity.

| Dimension         | Candidate for test fixtures                                         | Evidence required before freeze                                                                                                                                |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source bytes      | 12 MiB maximum                                                      | Stream memory and disk use, rejection timing, API backpressure.                                                                                                |
| Dimensions        | 10,000 px per side; 24 MP total                                     | Decoder peak RSS, decompression-bomb rejection, pathological aspect ratio.                                                                                     |
| Renditions        | 320 / 480 / 1600 / 2048 px; four WebP outputs                       | Marking readability, no upscaling, aspect ratio, bytes and decode time.                                                                                        |
| Encoded output    | <= 1 MiB per rendition; <= 3 MiB total candidate                    | Quality/legibility across representative controlled equipment images.                                                                                          |
| Worker/verifier   | 20 s wall, 10 s CPU, 512 MiB memory, one concurrent job             | Target VDS-equivalent measurements with codec build, isolated verifier, API verification and representative load included.                                     |
| Aggregate budgets | Numeric values TBD; per-actor, per-product and global caps required | Concurrent upload/verification count, queued work, retained source+rendition bytes, staging bytes, disk-watermark behavior, and anonymous public request load. |
| Staging retention | 24 h candidate for abandoned temporary artifacts only               | Crash/restart recovery and cleanup proving no linked source or rendition is removed.                                                                           |
| Cache             | `max-age=300, must-revalidate`                                      | Revoke/unpublish behavior, origin/cache behavior, stale URL and browser cache observation.                                                                     |

Use only controlled/licensed fixtures in an isolated non-production profile. Include high-resolution photographs with visible model markings, malformed/truncated images, MIME/signature mismatch, multiframe files, huge dimensions, metadata-bearing inputs, duplicate attempts, stale attempts, disk-full, process kill, API restart, worker timeout, missing/checksum-mismatched stored output, concurrent publish/revoke, and cache validators. Record hardware, codec versions, memory/CPU/disk peaks, wall time, readability, retry behavior, and exact fixture source/license.

## Required acceptance evidence for later implementation

These are future gates, not checks that can pass on this documentation-only PR:

- DB constraint tests prove source/product/revision/set/derivative namespace binding and prevent cross-product or cross-generation attach.
- DB tests prove one source FileVersion cannot be claimed by two products; `(renditionSetId, variant)` is unique; all profile-required variants exist exactly once before READY; source and derivative FileObjects remain PRIVATE/eligible.
- Concurrent retry tests prove actor-scoped idempotency-key reservation converges for same-body requests and rejects changed body/target; storage intents prove lease fencing blocks stale-writer commits and cleanup, including a paused writer racing reconciliation, temporary-stage crash recovery, file/directory durability ordering, and both transaction race orderings.
- Transaction/race tests prove OCC, publication, product archive, media revoke, product-match confirmation bound to the exact rendition-set/manifest, and public GET/HEAD/304 cannot serve a stale/unpublished/revoked generation after origin authorization recheck.
- Worker adversarial tests prove exact job/digest/profile/policy binding, echoed single-use nonce consumption, replay/mismatch rejection, idempotent retry, changed-body conflict, stale output rejection, no secret/path/ID leakage, API-only ingress, denied egress, and bounded resource use. Malformed worker output is decoded only in a non-root isolated verifier with no network, host mounts, DB/storage authority, or unbounded IPC; the privileged API never runs the full image decoder.
- Storage crash/recovery tests prove intents survive process termination between DB reservation, physical write, FileVersion commit, derivative-set commit, and READY finalization; reconciliation only deletes exact expired unreferenced artifacts.
- API tests prove source/private FileVersions are inaccessible via generic routes; public route only serves verified WebP from PRIVATE/eligible FileObjects; safe uniform 404 versus dependency 503; 304 rechecks publication; HEAD has no body; headers/digest/length are correct; proxy status/header mapping is exact; total/idle timeout and downstream cancellation abort upstream; byte verification occurs before GET/HEAD/304 and mid-stream failures abort without fallback.
- Quota tests prove concurrent upload/job caps, staging/retained-media high-water behavior, pre-reservation rejection at a hard cap, and no deletion of linked files to reclaim space.
- RBAC tests prove default deny, exact target-product checks, no automatic grant, no rights from file ownership alone, and unchanged generic R1-002 `files.metadata.read` behavior.
- Audit tests prove human provenance confirmations have exact staff/time, worker events use only an approved service actor model, and logs omit raw bytes, keys, original names, rights evidence and PII.
- Frontend tests prove card image can be absent, detail gallery is a static ordered accessible image list, alt text/dimensions and responsive rendering are correct, native `<picture>` uses explicit same-origin `srcSet`/`sizes` for fixed variants, and no arbitrary URL/Next optimizer cache proxy is created.
- OpenAPI/client compatibility is checked before any public response change: update the generated schemas/known clients first; if consumers cannot be inventoried or a strict older client must remain compatible, use versioned public response routes and leave V1 image-free.
- Full review/benchmark and one exact-head CI run are required after runtime implementation. No check in this proposal substitutes for those gates.

## Pending owner decisions before freeze

1. **ADR-004 media exception:** confirm the proposed versioned exception: original remains unusable; a derivative remains globally `UNCHECKED` but may be served only through the narrowly scoped catalog route after isolated decode/re-encode verification. This is not an antivirus or malware-clean claim. If this exception is rejected, a separate quarantine/scanning policy must satisfy ADR-004 before upload or public delivery.
2. **System audit identity:** approve or reject a narrowly constrained `SYSTEM` actor kind in a versioned R1-002 audit amendment for only media `processed` and `availability.changed` events, with null staff/operator identity, finite action registry, requestId=jobId, and no authority to mutate/publish; or select an already approved service-event mechanism. Worker events must not be attributed to the uploading staff member.
3. **Public route topology:** accept the fixed Next.js Route Handler based on the current repository topology, or provide a verified same-origin reverse-proxy config before implementation. Do not expose `API_INTERNAL_URL`.
4. **Public identity format:** confirm random opaque UUID for `publicAssetId` and `renditionSetId` or another non-capability identifier. `publicAssetId` remains stable for one logical image/product; generation ID changes when output bytes/profile change; IDs are never reused.
5. **Provenance evidence reference:** confirm an immutable internal reference supported by R1-002 file metadata or an existing rights record, and the minimum accepted evidence categories. External source URL or attribution alone is insufficient.
6. **Retention and revoke:** confirm that originals/linked generations are retained by default and that source deletion requires a separately approved retention/legal-hold policy; confirm no instant recall guarantee for downloaded/cache copies.
7. **Measured profile and limits:** approve final format, dimensions, bytes, worker limits/concurrency, staging cleanup grace, and cache TTL only after the benchmark evidence above.
8. **Legacy media:** confirm explicit human re-ingest/review/detach as the only path for existing ProductMedia rows lacking provenance; no automatic backfill.
9. **Strict OpenAPI clients:** approve the client-first optional-field update only after all consumers are inventoried and verified tolerant of new fields, or require new versioned public product response routes and keep the frozen V1 response unchanged.

MEDIA-01–06 decisions remain accepted as the design basis. The questions above concern implementable details or extensions to frozen contracts and are not silently resolved by this draft.

## Proposed implementation sequence after owner approval

| Stage       | Scope                                                                                                                                                                                                   | Gate                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| VIS-CAT-02B | Freeze additive R1-002 and ADR-004 media file/security amendment; namespaces, fenced storage intents, quarantine/worker/verifier boundary, audit actor model, disabled feature defaults.                | Data model, storage, AppSec, and infrastructure reviews; no public delivery.                                    |
| VIS-CAT-02C | Freeze R1-004 media ingestion/rendition/provenance/RBAC/OpenAPI extension; implement staff upload, processing, draft attachment, review/publish checks, revoke and same-origin public derivative route. | DB race/runtime/security tests; generated OpenAPI/client compatibility before response change; no auto-publish. |
| VIS-CAT-02D | Staff interface for upload status, rights evidence, exact product-match confirmation, rendition preview, replacement and revoke.                                                                        | Accessibility, permission-denial, audit and usability review.                                                   |
| VIS-CAT-02E | Public catalog card/detail image DTO and responsive gallery; controlled rollout only after rights, operational benchmark, and owner launch approval.                                                    | Visual review, image quality/accessibility, no external-origin leakage.                                         |

No later stage begins automatically when this proposal is reviewed. Production enablement and any role grant require separate explicit operational approval under repository policy.

## Repository topology evidence

The current repository search found no Nginx, Caddy, Traefik, ingress, or reverse-proxy route for public catalog media in `infra` or `apps/web`. `infra/compose/compose.yaml` provides `API_INTERNAL_URL` to the web service, and the existing catalog client uses that only server-side. This supports a fixed Route Handler proposal but does not prove production topology; deployment config must be rechecked during VIS-CAT-02B/02C.
