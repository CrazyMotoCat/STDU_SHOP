# SEC-API-02 proposed contract amendment

Status: PROPOSED / REVIEW_REQUIRED. Baseline: main ff7de334a01e9aabf38a19bdcffd7b201755de16.

## Scope and approval

The owner approved Cloudmersive development and retained the production download prohibition. This proposal requires separate approval before changing FROZEN R1-010 or R1-010D. It defines the smallest proposed test deployment and the conditions for any later positive download path.

| Current requirement | Proposed change | Implementation and acceptance |
| --- | --- | --- |
| R1-010 attachment policy requires denial before storage until exact-original eligibility is separately approved | Keep denial in the first implementation. Define a second amendment for an isolated test site with synthetic originals and explicit eligibility | Existing downloadDocument and L0 regression suite remain authoritative until that amendment. Verify 401, 403, scoped 404, zero storage reads and zero success audits |
| R1-010D specifies ClamAV, the isolated worker, lease-bound streaming and scanner-specific completeness gates | Allow an explicitly selected Advanced HTTPS provider for a synthetic-only profile. Preserve the lease and original identity checks. Define provider-specific evidence and failure mapping | Reuse the existing Stage B job and fencing design after reviewing its SQL against current main. Do not bring PR28 in as a dependency or apply its migrations implicitly |
| R1-010 upload authorizes anonymous intake through a capability and already checks signature, stored structure, MIME, extension and SHA-256 | Keep the existing upload contract. Add bounded policy checks at scan time on the exact staged original where existing validation is insufficient | Cover broken PDF, ZIP expansion, mismatched format, encryption and CSV encoding. Original upload remains immutable and quarantined |

## Observation and decision

Use a dedicated worker with concurrency one and a lease-bound private stream. The API owns access and private storage. Claim and finalization must bind job, lease version, document ID, object identity, byte count and SHA-256. A replacement needs a new identity and job. The provider adapter has no storage write, download or database authority. A process crash or stale lease cannot finalize a replacement or replay evidence against another original.

Use Advanced Scan with a fixed HTTPS endpoint because the observed policy flags distinguish several structural or content risks. Keep the byte limit below the confirmed endpoint limit for the selected account. Preserve the PoC absolute deadline, response cap, no redirects, explicit false allow flags and strict response checks. Accept the documented nullable findings only in the clean-verdict context. Treat conflicting flags, missing evidence and format mismatches as indeterminate. Do not widen the CSV format allowlist based on the redacted live observation.

| Internal outcome | Existing equivalent or proposed treatment | Staff original download |
| --- | --- | --- |
| PENDING | QUARANTINED and pending job | Denied |
| INFECTED | REJECTED with a supported threat reason | Denied |
| SCAN_ERROR | Retryable or terminal SCAN_ERROR according to the approved job policy | Denied |
| SCAN_INDETERMINATE | Existing fail-closed SCAN_ERROR with an approved reason mapping | Denied |
| CLEAN_VERIFIED | Internal candidate only after local validation and coherent provider result for the same immutable bytes | Denied under L0. Future test eligibility needs separate approval |

SEC-API-01B used 18 requests and two local checks. Standalone EICAR and a separate XLSX package part were detected. The marker in a worksheet cell was missed in both modes. The owner excludes that marker as a pass criterion for integration. Advanced reported a malformed PDF clean. Local structure validation therefore remains mandatory. Advanced CSV format evidence was indeterminate. Neither HTTP 200 nor a provider verdict proves structural integrity or nested coverage.

## Configuration and lifecycle

Proposed feature flag: SEC_API_02_SYNTHETIC_SCAN_ENABLED, default false. A test-only isolated process supplies CLOUDMERSIVE_API_KEY through its environment. It verifies the explicit synthetic fixture allowlist and environment at startup. A flag alone cannot authorize customer data. Store no key, file bytes, raw response body or provider filenames in logs. Restrict network egress to the configured provider origin.

Maintain a durable operator-configured local budget per accounting window. Reserve before each request under lock. Count ambiguous transport failures as spent and never retry automatically within an attempt. Stop on 401 or 403, exhaustion, or 429 until the configured cooldown and operator policy permit a new attempt. Treat local reservations as a conservative budget, with Portal reconciliation when available. A plan quota is not a guarantee of endpoint limits or billing units.

Before synthetic activation, confirm plan, endpoint size and spending cap. Before customer files, obtain an account-specific determination covering region and failover, retention for payloads and diagnostics, subprocessors, deletion, and applicable transfer terms. Vendor public materials describe stateless processing and available regions. They do not attest to routing or log retention for this account. [Security](https://cloudmersive.com/security) · [DPA](https://cloudmersive.com/data-processing-dpa) · [Subprocessors](https://cloudmersive.com/subprocessors)

Rollback disables claiming and outbound calls, drains or fences in-flight attempts and retains quarantined originals and history. Existing L0 denies all staff original downloads throughout the rollback.

## Verification plan after contract approval

1. Adapter unit tests with mocked HTTP for PDF, CSV and XLSX, threat, timeout, 401, 403, 429, 500, malformed JSON, missing flags, contradictory verdict and nullable findings.
2. Structural fixtures for a damaged PDF with mocked CLEAN, encrypted PDF, mismatched XLSX extension, ZIP expansion and invalid CSV encoding. Check spreadsheet formula injection at export or spreadsheet interpretation boundaries.
3. Disposable PostgreSQL tests for atomic job creation, concurrent claim, durable quota reservation, stale lease, replaced version, changed bytes and replay. Test a disabled flag with zero outbound requests.
4. Preserve existing auth and L0 regressions and test direct URL and quarantine denial. After a separately approved test-only eligibility contract, prove session, permission, scope, membership, active eligibility and immutable identity checks before any byte is emitted. Cover revocation versus new authorization, attachment disposition, nosniff and safe MIME.
5. Independent backend, database and application security review plus applicable contract and runtime checks. No CI configuration changes or paid live requests.

## Owner decision

Approve the proposed synthetic-only Cloudmersive amendment as the first implementation slice, preserving L0. Define and approve any positive test download eligibility in a separate versioned amendment. Production transfer, download and deployment remain separate decisions.

Current delivery: BLOCKED on versioned contract approval. This Draft contains design and acceptance criteria only. No adapter, migration or download implementation is represented as complete. Tests were not run for this documentation-only proposal.
