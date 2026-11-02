# R1-010D-L0 — proposed versioned amendment and implementation gate

**DRAFT / REVIEW_REQUIRED / NOT FROZEN.** The owner approved the L0 policy and preparation of an implementation Draft PR based on [PR #31](https://github.com/CrazyMotoCat/STDU_SHOP/pull/31) at `56c1f23d706429f97a274737f1fbce1277cbed47`. This does not freeze a new contract version, authorize merge, production inventory, migration, deployment or opening a gate. Existing R1-010 1.0.2 and R1-010D 1.0.0 FROZEN artifacts remain unchanged and their checkers must pass.

## Proposed contract amendment — owner approval before integration

Replace the R1-010 attachment security policy section “Quarantine and download” and domain contract “File boundary” statement that CLEAN is sufficient with: “Staff inquiry-original download requires current staff session, existing permissions and inquiry scope, and valid eligibility for the exact original under a separately approved contract. Until such eligibility exists and is implemented, every inquiry-original staff download is denied before storage is opened, including legacy CLEAN. No bytes or success download audit are emitted; document metadata, states and history are preserved.” The normal 401 and permission/scope 403/404 behavior remains; after these checks an unavailable document or policy denial returns existing `404 FILE_NOT_ACCESSIBLE`. Infrastructure failures retain current error handling; no blanket mapping to 404 or unsupported promise of 503 is introduced. A later positive path, changes to R1-010D scanner semantics, permissions, schema, audit taxonomy or storage policy require separate owner-approved amendments.

After formal approval, select and record version and hashes, update R1-010 OpenAPI `downloadStaffInquiryDocument`, attachment policy, domain contract, test matrix, manifest, generated metadata and checkers; synchronize R1-010D §§1–3/7 and ADR references if PR #28 is later integrated. The present implementation intentionally differs from current FROZEN CLEAN-only download, so it must not merge before amendment freeze and required checks. Existing artifacts have not been edited.

## Test/deployment gate

Synthetic runtime tests cover authorization and no file opening or byte disclosure, with an existing CLEAN original; current source and historical audit must remain untouched. See the implementation tests and verification report in the PR for actual coverage and NOT RUN cases. External fail-closed gate must be proven over old/new/mixed binary, direct ports, aliases, internal scan listener and private storage; production ingress, volumes and network are not inspected by this task. Rollout and rollback remain BLOCKED until coverage, draining of already-authorized streams and separate production authorization are established. Any old binary must remain behind the closed gate. CLEAN enablement and CSV/PDF/XLSX policy remain BLOCKED / NOT_PROVEN.

## External gate acceptance matrix — NOT RUN

These are separately required deployment-model tests, not evidence that a gate currently exists or is configured. An isolated gate must be independently tested on actual network paths and fail closed before any deployment decision.

| Fixture / operation                            | Required observation                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Old binary + legacy CLEAN + gate closed        | Staff download is blocked before old binary; no bytes or successful download audit.                                                             |
| New binary + gate closed / opened              | Closed blocks all paths; opened reaches new unconditional deny after auth and no bytes. Opening a real gate needs separate owner authorization. |
| Mixed old/new instances                        | Common closed gate blocks both; no traffic may reach old instance via direct API or alias.                                                      |
| Rollback from new to old                       | Close and verify gate first, account for already-authorized streams, keep gate closed through and after downgrade.                              |
| Direct API port / alias                        | Any ungated route is a blocker; verify host/container binding and network reachability, do not infer from Compose.                              |
| GET / HEAD / Range / URL normalization         | All variants fail closed with no bytes; verify every ingress and rewrite.                                                                       |
| Internal scan stream                           | Not exposed to external clients; invalid/foreign/expired lease cannot read; do not change scanner or worker.                                    |
| Private storage / bind mount / backup / export | No unauthorized direct read or alternate file-serving path; enumerate all deployment principals and routes.                                     |

A compromised API or storage administrator with filesystem access lies outside the HTTP-path gate threat boundary. Unknown ingress, direct storage reachability, DB outage, mixed old binary or untested route coverage keeps production rollout BLOCKED.

## Verification notes and limits

`pnpm test:r1-010b` exercises a disposable PostgreSQL/Redis and HTTP application: synthetic uploads, four stored source states including an actual pre-existing file marked CLEAN, session/permissions/scope, foreign/missing documents, HEAD, Range, encoded URL, preserved original bytes and audit history, and unavailable PostgreSQL access for the API login. The DB fault uses a verified owned Compose project, tmpfs, loopback binding and matching DB URLs; it restricts only the API login and restores it in `finally`. It is **not** a full PostgreSQL server or network outage. Verify the PR's checks for the precise final run result.

The encoded `%64ownload` URL currently returns `500 INTERNAL_ERROR` from the existing boundary, with no original bytes; the canonical URL and Range return 404. No global error behavior was changed. Actual old-binary/mixed rollout, external gate, production network/storage and PR #28 internal scan-stream were **NOT RUN**; the matrix above is a plan, not evidence.

The isolated `pnpm test:r1-010c:e2e` browser run completed 13 checks, including public inquiry upload and quarantine, with its own Compose project and no host-published ports. It does not test the external gate or old/mixed deployment.
