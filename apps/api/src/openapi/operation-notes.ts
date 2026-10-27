// Contract-facing invariant notes attached to guarded implementation routes.
export const STAFF_OPERATION_CONTRACT_NOTES = {
  getCsrf: {
    invariants: [
      'No valid staff session: hash-only ephemeral Redis login challenge + HttpOnly cookie. Valid session: stable HMAC binding. No cache/logging.',
      'Response header Set-Cookie for login challenge/expired-cookie clearing; flags normative in auth-security.md.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  login: {
    invariants: [
      'Consume one-time Redis challenge before credential check. Existing valid staff session uses STAFF CSRF then 409; logout first.',
      'Unknown email/wrong password/BLOCKED same 401. No user enumeration shortcuts.',
      'Commit session + audit before Set-Cookie. token never JSON. PasswordChangeRequired sessions are restricted.',
      'After out-of-transaction Argon verification, lock StaffUser FOR UPDATE and revalidate exact verified passwordHash/authVersion plus ACTIVE before creating session. Snapshot changed => generic401 INVALID_CREDENTIALS. Session-limit count/eviction/create serialized under same user lock. No session minted from stale credentials.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  logout: {
    invariants: [
      'Session revoke and audit atomic; audit failure rollback503 and no clear cookie. Unknown/expired session401 clears cookie.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getMe: {
    invariants: [
      'Allowed with passwordChangeRequired. No role/session/hash internals.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getMyPermissions: {
    invariants: [
      'Sorted unique current permissions; passwordChangeRequired returns empty permissions; UI is not authority.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  changeMyPassword: {
    invariants: [
      'Allowed with forced-change flag. Require currentPassword. New password differs from current; invalid/reused new password400.',
      'One transaction: new hash/flag/version/authVersion, revoke old sessions, create new current session and audit. Set-Cookie after commit; fetch new CSRF.',
      'Before Argon:10 attempts/15min/user,20/15min/source,5 failures/15min/user; bounded backoff. Redis unavailable503; exceed429 with Retry-After, no mutation.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listStaffUsers: {
    invariants: [],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createStaffUser: {
    invariants: [
      'ACTIVE, passwordChangeRequired=true, roleIds empty. Never return/log initialPassword.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  setStaffUserState: {
    invariants: [
      'Never own status mutation. Advisory lock, actor revalidation, control-admin and full-admin preservation invariant. authVersion++ and revoke all affected sessions on real change.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  revokeStaffUserSessions: {
    invariants: [
      'Own session revoke uses logout/password rotation. Increment target authVersion/version and revoke all sessions atomically.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  assignStaffRole: {
    invariants: [
      'expectedVersion is target StaffUser.version. No self assignment/removal. New assignment only ACTIVE role and ACTIVE target; grant ceiling checks entire role.',
      'Remove allowed for BLOCKED target to clean assignments. Existing assignment put/missing assignment delete = no-op200 only after auth/version/policy checks; no duplicate audit or revoke.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  removeStaffRole: {
    invariants: [
      'expectedVersion is target StaffUser.version. No self assignment/removal. New assignment only ACTIVE role and ACTIVE target; grant ceiling checks entire role.',
      'Remove allowed for BLOCKED target to clean assignments. Existing assignment put/missing assignment delete = no-op200 only after auth/version/policy checks; no duplicate audit or revoke.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listRoles: {
    invariants: [],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createRole: {
    invariants: [
      'Duplicate immutable role code409 VERSION_CONFLICT; no permissions/assignments implied.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  changeRole: {
    invariants: [
      'At least name or state required beyond expectedVersion. Code immutable. ARCHIVED terminal, rename allowed ACTIVE only.',
      'Archive requires zero UserRole, protected by same advisory lock; no mass assignment removal. Permission edits excluded from this DTO.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  replaceRolePermissions: {
    invariants: [
      'Only ACTIVE role. Reject if caller assigned target role; additions subset actor current permissions.',
      'Advisory lock + version CAS + control-admin and full-admin union check. Invalidate/revoke all assigned users and audit same transaction. No-op200 only after policy/version checks.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
      'Apply x-admin-preservation: preserve a usable ACTIVE employee whose own effective ACTIVE-role union contains all 12 fullAdminProtectedPermissions, as well as the control-admin invariant, under the shared advisory lock in the same transaction. Relevant state changes, credential readiness and multi-role reductions cannot bypass this check. No role-name or privileged bypass. LAST_ADMIN_REQUIRED rolls back rows/versions/sessions; separate DENIED audit, never SUCCESS.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listRegisteredPermissions: {
    invariants: [],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSellers: {
    invariants: [],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createSeller: {
    invariants: [
      'DRAFT only; nullable absent fields persisted NULL. INN uniqueness conflict409 VERSION_CONFLICT. No client organization, tax computation or bank defaults.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getSeller: {
    invariants: [
      'GLOBAL internal seller directory in B; ID never grants permissions.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  changeSeller: {
    invariants: [
      'At least one field beyond expectedVersion. Resulting kind/INN/KPP/OGRN constraints validated as a whole. ACTIVE needs legalName/INN.',
      'ARCHIVED terminal immutable; DRAFT<->ACTIVE allowed only before future domain references exist. No quote readiness claimed.',
      'Mutation response only data{id,version}+meta. Full staff/role/seller read DTO requires its separate read permission (self Me exception only); mutation permission alone never discloses read-protected fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listAudit: {
    invariants: [
      'No request bodies, credentials/hash, raw IP, full requisites. Cursor uses occurredAt/id. No generic payload or UPDATE/DELETE.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getFileMetadata: {
    invariants: [
      'Permission first, then persisted owner OR INTERNAL typed seller link with sellers.read. PRIVATE always owner-only. Unknown/denied object same404.',
      'Version relationship checked server-side; storageKey/path never DTO. UNCHECKED, no upload/download/scan endpoints. B test fixtures only. No artificial response version-count cap; future pagination requires explicit compatible contract.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSuppliers: {
    invariants: [
      'Keyset cursor is opaque and bound to the supplier state filter; archived rows require an explicit state filter.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createSupplier: {
    invariants: [
      'One transaction appends the immutable first profile revision, updates the current projection and writes the allowlisted audit event. Idempotency replay returns only the sanitized receipt.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getSupplier: {
    invariants: [
      'Contacts, tax identifiers and internal notes are returned only with suppliers.read; no public DTO contains supplier fields.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  updateSupplier: {
    invariants: [
      'Expected-version CAS appends a complete immutable profile revision and changes the current projection and audit atomically.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierRevisions: {
    invariants: [
      'Immutable profile revisions are private and keyset-paginated; global audit never receives contact/requisite/note values.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  archiveSupplier: {
    invariants: [
      'One-way OCC transition; existing offers and histories remain, and no child state is cascaded.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listOffersForSupplier: {
    invariants: [
      'Offer read requires suppliers.read as well as suppliers.offers.read; freshness and effective match status are separately derived.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierOffers: {
    invariants: [
      'Offer read requires suppliers.read; cursors bind filters and sort. Currency groups use COLLATE C and no cross-currency numeric ranking or FX conversion occurs.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createSupplierOffer: {
    invariants: [
      'Active supplier required. The first immutable MANUAL offer revision and root commit with audit. No product, price or quotation is changed.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getSupplierOffer: {
    invariants: [
      'Requires suppliers.read and suppliers.offers.read; purchase cost, provenance and matching facts never enter public DTOs.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  reviseSupplierOffer: {
    invariants: [
      'Expected-version CAS appends a complete immutable revision. Supplier price changes have no catalog or quotation side effect.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  archiveSupplierOffer: {
    invariants: [
      'One-way OCC state transition retains immutable revisions, decisions and current-match history.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierOfferRevisions: {
    invariants: [
      'Requires suppliers.read and suppliers.offers.read; cost and provenance are returned only by this authorized staff history route.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listExactSupplierMatchCandidates: {
    invariants: [
      'Requires supplier, offer, catalog-product and catalog-reference permissions. Candidate set uses only the exact normalized four-field R1-004 identity tuple; UNKNOWN modification never matches null.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierMatchProposals: {
    invariants: [
      'Requires suppliers.read, suppliers.offers.read, catalog.products.read and catalog.references.read; proposals remain item-by-item with immutable decision history.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createSupplierMatchProposal: {
    invariants: [
      'One exact candidate becomes one PENDING proposal; creation does not set the current pointer. Partial uniqueness prevents two active pending proposals for the pair.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  decideSupplierMatchProposal: {
    invariants: [
      'Locks offer, proposal and product, revalidates versions, pointer and exact snapshots, then writes a terminal decision, pointer when approved and audit in one transaction.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  unlinkSupplierOfferMatch: {
    invariants: [
      'Requires expected offer version and current pointer; clears only that pointer and never restores an older approved proposal.',
      'Returns only the sanitized {id, version} offer mutation receipt so durable idempotency replay never stores or returns purchase cost; full Offer remains on its separately authorized read route.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierAudit: {
    invariants: [
      'Requires audit.read plus suppliers.read; returns only allowlisted IDs, actor, time, action, reason and changed field names.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listSupplierOfferAudit: {
    invariants: [
      'Requires audit.read, suppliers.read and suppliers.offers.read; no price, contact, source URL, notes or arbitrary AuditEvent changes are serialized.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID for unsafe',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listStaffInquiries: {
    invariants: [
      'Read scope is the live union of inquiries.read_all and inquiries.read_assigned; default list shows the actor-assigned queue. No contact snapshot is serialized.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  getStaffInquiry: {
    invariants: [
      'Current read scope is revalidated before lookup; contact values are omitted without inquiries.contacts.read. Original submission and equipment lines are immutable.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listInquiryEvents: {
    invariants: [
      'Only inquiry action, outcome, timestamp, actor ID and status endpoints are exposed; no AuditEvent changes or PII.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  assignInquiryManager: {
    invariants: [
      'ACTIVE target and actor read scope are required; If-Match, durable idempotency, assignment and audit commit atomically. Assignment cannot be cleared.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  assignInquiryEngineer: {
    invariants: [
      'ACTIVE target and actor read scope are required; If-Match, durable idempotency, assignment and audit commit atomically. Assignment cannot be cleared.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  setInquiryStageDeadline: {
    invariants: [
      'Only an explicit staff stageDueAt is accepted; no customer deadline parsing or SLA automation. OCC, audit and idempotency are atomic.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  transitionStaffInquiry: {
    invariants: [
      'Only approved workflow edges or typed pre-quote CLOSED reasons are accepted. QUOTE_SENT cannot be set here. Successful transition clears stageDueAt and atomically commits OCC, audit and idempotency.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listStaffInquiryComments: {
    invariants: [
      'Only append-only INTERNAL comments are returned inside the actor read scope; comments require inquiries.comment and are never customer-visible.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  createStaffInquiryComment: {
    invariants: [
      'Comment is append-only; comment and audit commit together. Idempotency receipt contains only inquiry/comment IDs and version, never comment body.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'ORIGIN_FORBIDDEN/CSRF_INVALID',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  listStaffInquiryDocuments: {
    invariants: [
      'Metadata is scoped and separately permissioned. Storage keys and capability values are never serialized; files without an operational scanner remain QUARANTINED.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
  downloadStaffInquiryDocument: {
    invariants: [
      'Requires read scope plus inquiries.documents.read and inquiries.documents.download; only CLEAN bytes stream through NestJS with no-store/nosniff and attachment disposition. No scanner means no downloadable document.',
    ],
    errorsBeforeObjectLookup: [
      'AUTH_REQUIRED',
      'PASSWORD_CHANGE_REQUIRED',
      'FORBIDDEN',
    ],
  },
} as const;
