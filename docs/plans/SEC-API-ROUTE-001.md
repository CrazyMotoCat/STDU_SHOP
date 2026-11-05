# SEC-API-ROUTE-001 — encoded routes and HTTP boundary

Status: implementation prepared for owner review; no merge or deployment authorization.
Baseline: `87e2bdf044b51658dc2cca2536fef2c4a38dd1da`.

## Root cause and scope

Nest's route resolver raises `NotFoundException` for unmatched URLs. Express does not decode percent-encoded static literals into registered route names. The shared HTTP boundary did not recognize that framework exception in staff/catalog namespaces, so a normal routing miss became `500 INTERNAL_ERROR`. Ten assertions reproduced this on the unchanged baseline.

Recognize only `NotFoundException` and use the existing sanitized `404 NOT_FOUND` envelope. Existing `StaffError` takes precedence. No routing/decoding middleware, guards, permissions, storage, DTO, frozen contract or download policy changes. Ordinary internal exceptions retain 500 and requestId diagnostics; the legacy boundary for unrelated routes is unchanged.

## Bounded route matrix

`D` below means `/v1/staff/inquiries/{inquiryId}/documents/{documentId}/download`. IDs in runtime checks identify synthetic resources in a disposable database.

| Request / variation                                                         | Expected result                                                                                        | Evidence                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| D ending `%64ownload`, `%2564ownload`                                       | 404 NOT_FOUND; no download service or storage call                                                     | HTTP harness and authenticated/anonymous runtime |
| `%64ocuments`, `%69nquiries` static segments                                | 404 NOT_FOUND; no download service or storage call                                                     | Harness and runtime                              |
| `//download`, `%2fdownload`, `down%2Fload`                                  | 404 NOT_FOUND; no download service or storage call                                                     | Harness and runtime                              |
| `%2Fdownload`, `%252fdownload`, `down%2fload`                               | 404 NOT_FOUND; no handler                                                                              | Harness                                          |
| Unregistered download suffix                                                | 404 NOT_FOUND; no download service or storage call                                                     | Harness and runtime                              |
| `/v1/staff/auth/%6de`, `/v1/staff/%75sers`, `/v1/staff/catalog/%70roducts`  | 404 NOT_FOUND, same for authenticated and anonymous clients                                            | Runtime                                          |
| Unknown staff/catalog, public catalog, public inquiry and attachment paths  | 404 NOT_FOUND, sanitized envelope                                                                      | Harness                                          |
| `/v1/staff/catalog//products`                                               | 404 NOT_FOUND                                                                                          | Harness                                          |
| D canonical                                                                 | Existing 401/403/safe 404 according to session, permissions and scope; originals denied before storage | Runtime                                          |
| Uppercase `DOWNLOAD`, trailing slash, percent-encoded digit in dynamic UUID | Existing registered route matching; domain denial, not a new route rejection policy                    | Harness                                          |
| Malformed dynamic parameter `%E0%A4%A` or `%ZZ`                             | 400 VALIDATION_ERROR; no handler                                                                       | Harness                                          |
| Registered staff catalog/public catalog/public inquiry paths                | Existing successful response                                                                           | Harness; domain regressions in runtime/CI        |
| Unrelated unknown path                                                      | Legacy HTTP 404                                                                                        | Harness                                          |
| Framework NotFoundException with private message                            | 404 NOT_FOUND without exception text                                                                   | Harness                                          |
| Error or unexpected HttpException(503) in staff route                       | Existing sanitized 500 INTERNAL_ERROR plus requestId diagnostic                                        | Harness                                          |

This is a bounded regression matrix, not a new URL canonicalization contract. Existing case-insensitive matching, optional trailing slashes and dynamic parameter decoding remain unchanged. A static unmatched route is independent of private resource existence and session state. Real internal failures are not reclassified as resource absence.

## Verification

- `pnpm exec vitest run apps/api/test/http-boundary-routes.test.ts`: 30 passed; real Nest/Express HTTP listener, no database.
- `pnpm test:r1-010b`: 34 passed, 1 existing opt-in skip. Disposable PostgreSQL/Redis + full API, 11 forbidden URLs for both authenticated and anonymous clients. No `downloadDocument` or `openInquiryQuarantine` calls, no document-byte prefix in JSON responses, no new download-success audit; document rows, existing audit and stored bytes remain unchanged.
- `pnpm --filter @stdu/api typecheck`, `pnpm exec eslint . --max-warnings 0`: passed.
- `pnpm contract:check`, `pnpm catalog:contract:check`, `pnpm r1-010d:contract:check`: passed; no frozen changes.
- Independent read-only security review: PASS, no P0/P1/P2. Reviewer independently ran the 30-case HTTP suite and inspected the installed Nest route resolver, production diff and runtime assertions.

Final hosted FAST/FULL checks and exact candidate SHA are recorded in the Draft PR, rather than inferred from local results. OPS-TEST-02 and other projects are not used or modified.
