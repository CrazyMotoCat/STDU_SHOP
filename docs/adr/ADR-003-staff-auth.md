# ADR-003: Staff authentication and authorization

Status: ACCEPTED by the owner in the R1-001 implementation assignment, 2026-10-21. Implementation belongs to R1-002.

## Decision

Local staff accounts authenticate to NestJS. PostgreSQL stores server-side sessions. A cryptographically random opaque token (at least 256 bits) is sent only in a host-scoped HttpOnly cookie. Store a SHA-256 verification hash, never the raw session token. On HTTPS use `Secure`, `Path=/`, no Domain attribute, and `SameSite=Lax`; restrict development exceptions to explicit localhost configuration. Never place staff tokens in URLs or browser storage.

Sessions have configured absolute and idle expiry, revocation and rotation on login/privilege changes. Check account state and current permissions server-side; logout revokes the stored session and clears the cookie. Record security events without tokens or credentials.

Protect unsafe methods with an explicit CSRF token and same-origin validation; SameSite alone is insufficient. Login has rate limits by account and source, bounded backoff and generic failure messages. Hash passwords with Argon2id using reviewed parameters; no plaintext or reversible passwords, no default administrator password or public registration. Bootstrap and recovery procedures must be frozen with the R1-002 contract.

NestJS is the only authority for authentication, action permissions and object access. Roles are configurable permission bundles. UI visibility does not grant access. Default deny applies to staff routes. No Keycloak, external IdP or auth microservice is introduced.

## Separate trust boundaries

Customer quotation links are separate revision-scoped, expiring, revocable capabilities with their own token hashes and permitted actions. They never create staff sessions or corporate memberships. Corporate client accounts remain outside R1.

## R1-001 boundary

Document this model only: no users, sessions, role tables, login/logout handlers or simulated authentication. The health endpoints are explicitly public infrastructure endpoints and expose no private configuration. R1-002 freezes the schema, permission matrix, session/CSRF DTOs, error codes and OpenAPI before implementation.

References: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
