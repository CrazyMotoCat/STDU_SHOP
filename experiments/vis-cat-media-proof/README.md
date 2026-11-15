# VIS-CAT-MEDIA-PROOF — synthetic offline profile

Stacked on [PR #62](https://github.com/CrazyMotoCat/STDU_SHOP/pull/62) and its [proof matrix](../../docs/plans/VIS-CAT-MEDIA-PROOF.md). CD-01–04 are working inputs for this experiment. This profile exercises the recommended narrow CD-01 policy in simulation. The alternate mandatory-scanning profile is NOT_RUN. The ADR-004 exception remains inactive. The experiments use synthetic raster inputs, synthetic catalog relations and synthetic rights. Production routes, contracts and migrations are outside the experimental tree.

## Reproduce

From the root of a clean checkout with Python 3.14 and Pillow 12.2.0 installed in the selected interpreter:

```powershell
python -B experiments/vis-cat-media-proof/run_offline.py > $env:TEMP/stdu-media-proof-offline.json
```

On Linux amd64, install the existing [hash-pinned VIS-CAT-02B dependency](../vis-cat-02b/requirements.txt) into a dedicated virtual environment. On other platforms install the same Pillow version for the actual interpreter and record the codec build. The runner emits JSON to stdout and test diagnostics to stderr. The report identifies the Git commit, cleanliness, per-source SHA-256, protocol profile, V1 blob identities, Python/codecs/SQLite versions, source and canonical manifest digests, and three end-to-end host timing samples. Hash the report after saving it. Timing samples include child startup and IPC and cannot size a deployment. CI runs the same profile and prints exact candidate evidence in the FULL job log.

The worker reuses VIS-CAT-02B decoding and geometry while enabling orientation normalization and preserving alpha for this profile. The verifier is a fresh subprocess using separate structural checks and the same Pillow/libwebp build. It receives the WebP result and expected attempt, never the source bytes. The parent independently checks schema, canonical manifest, byte count, SHA-256, attempt identity and measured profile. Wall time, wire bytes, image pixels and encoded output are bounded. The POSIX child additionally has address-space and CPU limits. Windows has workflow deadlines and application-level budgets. Both subprocesses have the host process identity. This profile does not prove container or codec independence.

The SQLite ledger runs in a disposable private directory with generation-specific staging and final keys. It records filesystem object identity before no-replace promotion, and reconciles an uncertain commit against the current generation and actual digest. The proof uses one serialized writer transaction during bounded storage mutations. It demonstrates process restart, not a PostgreSQL row-lock protocol. File sync is exercised on both platforms and directory sync on POSIX. Unknown ownership is preserved even for bytes identical to an expected digest. The fixture directory assumes a single trusted owner and private ancestors. An external process mutating that directory concurrently is outside this profile. Discard the fixture directory at the end of each test process.

## Coverage and evidence boundaries

| Program | Executed offline                                                                                                                                        | Separate target evidence                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1      | JPEG/PNG/WebP decode and WebP re-encode, EXIF orientation, alpha and metadata removal, malformed/oversized/animated input and format mismatch rejection | Broader conformance corpus and alternate scanner policy                     |
| P2      | Two bounded processes, child crash/timeout and separate verifier checks                                                                                 | Per-container boundary, real effective mounts/network/cgroup, diverse codec |
| P3      | Canonical manifest and exact per-variant digest/geometry, wrong generation, duplicate variant and malformed output                                      | Wire transport and storage identity in the deployed topology                |
| P4–P5   | SQLite and filesystem no-replace, fenced concurrent delivery, runner exits, lost COMMIT acknowledgement, missing/corrupt objects and addressed cleanup  | PostgreSQL plus target filesystem, restore and physical durability          |
| P6      | Three exact-profile host process samples                                                                                                                | cgroup/queue/load and I/O distributions on target                           |
| P7      | Mock Staff preview, public GET/HEAD/304 with origin checks, loopback HTTP, route rejection, no original or internal references, V1 schema identity      | Real Next/Nest route/proxy normalization, full API deployment tests         |
| P8      | No-store/conditional requests, newer revision, asset/evidence revoke and expiry, in-flight snapshot boundary                                            | Browser/proxy cache policies and measured revoke window                     |
| P9      | Synthetic contrast, geometry, no upscale and orientation                                                                                                | Human reading of legally cleared photos at target desktop/mobile sizes      |

## Prepared target-only scenarios

**Container/cgroup.** On a separately authorized, dedicated amd64 Docker daemon, prepare the exact [VIS-CAT-02B image](../vis-cat-02b/README.md) and inspect its ID. Build the small derivative image under the same approved scope. Run one synthetic worker and one synthetic verifier sequentially using the VIS-CAT-02B lifecycle, with `network=none`, no ports or private mounts, fixed read-only profile and exact container cleanup.

```powershell
docker build --network none --platform linux/amd64 -f experiments/vis-cat-media-proof/Dockerfile -t stdu-vis-cat-media-proof:offline-candidate .
docker image inspect stdu-vis-cat-media-proof:offline-candidate --format '{{.Id}}'
python -B experiments/vis-cat-media-proof/run_container.py --image-id <exact-local-sha256-image-id>
```

Collect engine/host and effective profile before interpreting the in-container counters. This prepared smoke scenario reports cgroup v2 memory, CPU, PID and I/O counters and process timings without assigning target capacity. Record per-container startup and verify the pre/post inventory. Use [P2/P6](../../docs/plans/VIS-CAT-MEDIA-PROOF.md#подготовка-и-исполнение) to extend to separately approved load levels. A network timeout is insufficient for a complete isolation verdict. There has been no container execution for this new profile.

**Target storage.** Adapt the [VIS-CAT-02C fixtures and preflight](../vis-cat-02c/README.md) to approved disposable PostgreSQL and an owned volume. Repeat the P4/P5 cases from `test_offline.py` at the documented transaction, sync and promotion boundaries. Preserve canaries, keep a ledger of exact names, check the backed-up DB and file pair after an isolated restore, and preserve unknown artifacts for review. Physical power-loss and attached-network profiles are distinct approvals.

**Cache and real markings.** Use the same public GET/HEAD/revoke request sequence against the approved mock route through the planned browser/proxy chain. Record response headers, exact time from revoke to each fresh request and observed old-tab/cache behavior. For P9 use the rights-cleared set and its manual transcription as ground truth. At each candidate card/detail rendering and responsive size, have two independent readers record the part number, variant, units and significant symbols. Compare against the ground truth by rendition manifest digest and record critical transcription errors as failed. Keep real photographs and rights evidence in the approved private evidence area.

See the [contract decision package](../../docs/plans/VIS-CAT-02A-CONTRACT-DECISION.md) for owner decisions on contract freeze, real photos, target environment and later publication.
