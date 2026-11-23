# R1-009B Supplier staging commands

**DRAFT / REVIEW_REQUIRED / NOT FROZEN**

Extends SRC-03–07 and R1-009A at baseline `dab6cbad0756f8af76b4e9b51c60a2d6d81b79b3`. Normative proposal only. See [API and RBAC](../plans/R1-009B-api-rbac-compatibility.md), [data and rollout](../plans/R1-009B-data-migration-review.md) and [acceptance](../plans/R1-009B-test-matrix.md).

## Lifecycle

A valid row in a COMPLETE or PARTIAL run progresses from PENDING to terminal ACCEPTED or REJECTED under the existing decision API. ACCEPT authorizes consideration only. An ACCEPTED row may receive a target-specific preview and an explicit CREATE or UPDATE. Successful execution consumes the row once across all paths. A conflict keeps the row unconsumed unless a competing execution committed. The employee must refresh and explicitly confirm again. Error rows, rejected rows, disabled or changed sources and inactive suppliers are ineligible. Existing R1-009A rules also require active target offers.

- CREATE derives supplier from the captured source, checks the explicitly selected supplier against it, requires confirmed exact identity and checks active duplicates under the supplier lock. Creates an ACTIVE supplier offer and revision 1 with MANUAL origin and immutable application provenance. An exact active duplicate blocks CREATE and offers navigation to UPDATE. Archived matches are visible as warnings and require explicit acknowledgement. An unresolved possible duplicate requires review.
- UPDATE with explicit edits preserves identity and existing catalog linkage. Apply only the reviewed effective revision. An empty or no-op patch does not consume the row.
- Reconciliation is optional for exact source evidence, mandatory when facts are incomplete or ambiguous. Its approval is a separate evidence record, not ACCEPT or APPLY. For CREATE it binds the complete proposed identity and supplier. For UPDATE it binds the exact offer and current revision, without rewriting its identity. Changing row version, source version, source hash, target, or target revision invalidates it. Runtime derives NEEDS_REVIEW or BLOCKED when requirements are unmet.

## Edit policy

Each economic field uses a discriminated union `{op:"KEEP"} | {op:"SET",value:string} | {op:"CLEAR"}`. Omission is KEEP. Null, empty or whitespace-only SET values and unknown keys fail validation. KEEP retains original facts. SET is limited to the validated explicit non-null staged fact for that field. Every CLEAR appears in the diff and confirmation and records a reason.

| Field                                         | Proposed operations                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| purchaseCost                                  | KEEP, SET exact decimal, CLEAR                                                                        |
| currency                                      | KEEP, SET explicit ISO currency with SET purchaseCost, CLEAR only when resulting purchaseCost is null |
| sourceVatText, availabilityText, leadTimeText | KEEP, SET, CLEAR                                                                                      |
| sourceObservedAt                              | KEEP, SET ISO 8601 timestamp with explicit offset; defer CLEAR                                        |
| expiresAt                                     | KEEP by default; defer CLEAR and SET pending freshness policy approval                                |
| sourceUrl                                     | KEEP, SET validated source reference, CLEAR; immutable snapshot remains                               |
| All identity fields and offerName             | KEEP through economic UPDATE                                                                          |

A non-null cost requires currency. Clearing both fields requires two explicit operations. Currency change on an existing known currency is blocked in the minimum slice. Cost may be cleared while independently observed currency is retained. R1-007 freshness uses explicit expiry first, then configured age from observed time or recording time. Clearing observed time or expiry could make old data appear fresh, so this proposal defers both. Preview shows before and after freshness and distinguishes absence of a price from freshness of the revision. Public catalog retains its current ON_REQUEST projection. No FX conversion or inference of VAT, availability or delivery.

## Evidence and staff wireflow

Normalize identity text with NFC and trim only outer U+0020 spaces. Compare under PostgreSQL C collation without case folding or punctuation removal. Exact identity requires a staff-confirmed tuple of active brand ID, manufacturer, original part number, and SPECIFIED modification or explicitly evidenced CONFIRMED_NONE. Supplier part number and raw brand text are preserved as source facts and do not prove identity. Source UNKNOWN stays UNKNOWN in staging. Candidate suggestions are staff-only and may be ranked for navigation. They never authorize mutation.

Accept only references to attributable evidence such as a manufacturer datasheet with exact ordering code and variant, an authenticated supplier record with exact variant, or an internal verified product identity record with provenance. Capture evidence kind, controlled reference, relevant exact fields and reason. The proposed baseline requires confirmation by an eligible employee distinct from the reconciliation submitter. The owner must approve this separation. ACCEPT and APPLY still have their own gates and do not substitute for confirmation. Contradictory or insufficient evidence blocks execution. Evidence remains staff-only and is never fetched by the service.

The existing Staff UI gates ACCEPT on an eligible exact UPDATE preview. Add a read-only PENDING inspection mode for CREATE and incomplete identity that shows the original and normalized evidence and allows only a deliberate terminal decision through the existing decision endpoint. This mode issues no execution token. Preserve the existing UPDATE path.

Staff opens staging → compares original and normalized facts → records ACCEPT or REJECT → selects existing offer or CREATE → resolves missing identity and duplicate warnings → reviews a versioned preview → confirms CREATE/UPDATE and explicit CLEAR fields → sees receipt and provenance history. Version conflicts invalidate the preview while preserving proposed edits for comparison. Empty and blocked states state the missing evidence or permission.

## Owner decisions

1. Approve unified immutable application ledger and additive API.
2. Approve active exact duplicate policy, warning for archived matches, and exact normalization/brand requirements. Legacy R1-007 writers remain capable of creating independent offers under their frozen semantics.
3. Approve CLEAR whitelist and defer expiry/observation clearing. Decide whether later SET expiry needs separate permission.
4. Confirm evidence kinds, separation of duties and default-deny permissions for CREATE, explicit edits and reconciliation.
5. Approve an implementation slice of CREATE for already-complete exact identity using the shared ledger. Defer CLEAR and incomplete-identity approval until independently accepted.
