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
} as const;
