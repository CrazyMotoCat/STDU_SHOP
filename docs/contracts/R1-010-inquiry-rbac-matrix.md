# R1-010 Inquiry Permissions — FROZEN 1.0.2

Default deny applies. Permission codes are additive to the approved R1-002 catalog but do not alter the protected full-admin set. No code is assigned to a role automatically; no role name conveys authority. Contract approval and later explicit R1-002 RBAC grants are separate; this contract does not grant permissions.

| Permission                   | Capability                                                            | Additional policy                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| inquiries.read_assigned      | Queue/detail/history for inquiries where actor is manager or engineer | Unassigned items and all other inquiries are hidden. Contact values are redacted without contact permission.        |
| inquiries.read_all           | Queue/detail/history for every Inquiry                                | Contact values are redacted without contact permission.                                                             |
| inquiries.contacts.read      | Reveal submitted contact snapshot                                     | Also requires read_assigned or read_all. Does not independently authorize Inquiry access.                           |
| inquiries.assign_manager     | Assign or replace manager                                             | Also requires inquiry read scope; target ACTIVE and eligible to read assigned inquiries. Clearing is not supported. |
| inquiries.assign_engineer    | Assign or replace engineer                                            | Also requires inquiry read scope; target ACTIVE and eligible to read assigned inquiries. Clearing is not supported. |
| inquiries.transition         | Change workflow state or set current stage due date                   | Also requires inquiry read scope, If-Match, transition guards and reason. Cannot set QUOTE_SENT/CLOSED directly.    |
| inquiries.comment            | Append/read internal comments                                         | Also requires inquiry read scope. No public comment or customer message.                                            |
| inquiries.documents.read     | Read attachment metadata/security state                               | Also requires inquiry read scope. Does not allow bytes.                                                             |
| inquiries.documents.download | Download a source original                                            | Also requires inquiries.documents.read, inquiry read scope, and CLEAN safety state.                                 |

| Caller                                       | Action                                                 | Result                                                                                         |
| -------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Anonymous guest                              | Create Inquiry                                         | Public validation, rate limit, Origin and idempotency only; creates no staff identity/session. |
| Anonymous guest with bound upload capability | Create/upload/cancel one-file intents for that Inquiry | Capability hash must match the Inquiry; no read, status, metadata or download capability.      |
| Staff with read_assigned                     | Read assigned work                                     | Permission scope filters at query and detail boundaries.                                       |
| Staff with read_all                          | Read all work                                          | Does not imply contact, assignment, transition, comments or document permissions.              |
| Staff with contact permission only           | Read contact data                                      | Denied without inquiry read scope.                                                             |
| Staff without action permission              | Mutate assignment/state/comment/download               | 403; UI state is irrelevant.                                                                   |
| Staff with document download but no read     | Download source                                        | Denied; both permissions and domain scope are required.                                        |

Staff reads use existing FROZEN R1-002 session cookies. Unsafe staff routes require existing CSRF and exact Origin checks. Every endpoint rechecks effective permissions server-side. Contact fields and raw customer content are returned only to authorized staff; the public DTOs contain none of them.
