# Codex Task Template — paste into a new scoped assignment

**ID:** R1-___  
**Goal (visible to user):** ...  
**Scope / allowed modules and files:** ...  
**Source requirements:** CAT-__/SRC-__/REQ-__/SPEC-__/CALC-__/QUOTE-__/ADM-__; decision numbers ...  
**Dependencies & frozen contracts:** OpenAPI rev..., migration rev..., DTO...

### Acceptance examples

- Given ..., When ..., Then ... .
- Given invalid/unapproved data ..., When ..., Then operation is refused and historical state is preserved.
- Given unauthorized staff/anonymous user ..., When ..., Then appropriate access-denied response.

### Hard non-goals

- No customer orders/warehouse/production (R1).
- No automatic functional analogues; no auto/manual-batch parser approval.
- No new shared data model or auth decisions without lead review.

### Required checks

- Formatter / lint / type checks, unit + integration tests for touched module.
- If public UI/API changed: E2E and OpenAPI contract check.
- Security check for data leaks, file permissions, idempotency, approved revision immutability as applicable.

### Expected response

1. Scope fulfilled; notable behavior.
2. Changed files and contracts/migrations.
3. Commands **actually run** and test results.
4. Screenshots or demonstration path when UI involved.
5. Open issues, assumptions, next bounded action.
