# R1-009A Supplier review and individual manual apply

Status DRAFT. Additive implementation under the owner's R1-009 assignment.
R1-007 FROZEN 1.0.0 and R1-008B retain their existing endpoints and meanings.

## Scope and lifecycle

This slice provides the Staff ingestion workspace and one complete update scenario.
An employee selects a staging candidate and explicitly selects an existing SupplierOffer.
The preview displays the original source row, normalized values, current values, missing facts,
and proposed changes. ACCEPT or REJECT records a terminal decision with a required reason.
ACCEPT alone does not write SupplierOffer. APPLY is a separate deliberate command.
No automatic catalog matching, product creation, public pricing, or batch command exists.

Only candidate rows from COMPLETE or PARTIAL runs may be applied.
A source must remain ENABLED at the captured version. Source and target must share a supplier,
and supplier and offer must remain ACTIVE. Exact nonempty source supplier part number,
source brand text, manufacturer, original part number and SPECIFIED modification must equal
the corresponding existing revision fields. Similarity never authorizes an update.
This deliberately conservative update profile leaves incomplete identities for later manual work.

## Additive Staff API

All routes use existing staff sessions, guarded Origin and CSRF policies.

| Route                                                    | Purpose                                                              |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| GET /v1/staff/ingestion/rows/{id}/preview?offerId={uuid} | One bounded source row, comparison, eligibility and recent conflicts |
| GET /v1/staff/ingestion/rows/{id}/applications           | Immutable application provenance                                     |
| POST /v1/staff/ingestion/rows/{id}/apply                 | Apply exactly one accepted candidate to the explicit offer           |

Preview and history require ingestion.read, suppliers.read and suppliers.offers.read.
APPLY additionally requires ingestion.review and suppliers.offers.write.
The server revalidates all permissions from PostgreSQL before every command replay.
No new permission or role grant is introduced.

APPLY requires Idempotency-Key and body offerId, expectedRowVersion,
expectedOfferVersion, expectedOfferRevisionId and decisionId.
The decision must be ACCEPT for this row. The versions and current revision must match.
OCC failures return VERSION_CONFLICT, retain a durable conflict receipt and require
a fresh preview and a new deliberate command. No automatic PATCH retry occurs.

## Transaction and provenance

APPLY reuses R1-007 offer validation, immutable revision creation and supplier_offer.revised audit.
The caller owns one transaction covering the new revision, root pointer/version, audit,
application provenance and command receipt. Existing supplier/offer lock order is preserved.
One unique application is allowed per row, decision and newly created revision.
The append-only application records source, run, staging row, accepted decision, employee,
base revision, created revision, resulting offer version and source hash.
Database foreign keys, consistency trigger and update/delete denial protect this history.
A lost response or repeated identical key returns the original committed response.
A different key cannot create another application for an already applied row.

Only explicit non-null economic source facts are transferred.
Missing values retain the prior value, including expiresAt.
Currency is updated only with an explicit purchase cost, and changing an already known
currency is rejected. VAT, availability, delivery and currency are never inferred.
Identity, brand, offer name and catalog links are preserved.
The revision remains origin MANUAL because the employee intentionally executes it.
Its ingestion provenance resides in the separate immutable application.

Private source rows, prices and decision reasons are staff-only.
Audit payloads contain identifiers and codes, without source values or reason text.
Snapshot bytes, lease tokens and source credentials are excluded from preview responses.
Conflict history is limited to the latest 20 events for the selected row.

## Price freshness

Staff CURRENT, STALE and UNKNOWN reuse R1-007 derivation.
Explicit expiresAt takes precedence. Otherwise the configured freshness window uses
sourceObservedAt or recordedAt. Without a configured window, freshness is UNKNOWN.
Preserving a past expiresAt keeps a revised offer STALE.
There is no currency conversion or automatic freshness extension.

Current public catalog DTOs already return priceDisplay.kind ON_REQUEST and
label «Цена по запросу». Supplier revisions never feed public catalog prices.
Therefore an expired supplier price cannot become a public amount through this slice.
A future public price mapping requires its own approved source/freshness rule.

## Deferred R1-009B

Creating new SupplierOffer records from staging, explicit clearing of existing values,
broader manual identity reconciliation, and publication of public prices are outside R1-009A.
This partial slice is not a claim that all of R1-009 is complete.
Real external adapters, production deployment and production migrations remain separately gated.

## Verification

The isolated review suite exercises real PostgreSQL, Redis, mock Python extraction and Staff HTTP.
It covers authorization and CSRF, ACCEPT then APPLY, REJECT and error rows,
idempotent response replay and concurrent execution, stale offer versions,
immutable revisions/provenance, missing facts, freshness and catalog isolation.
The browser scenario covers the same service path at 1440 and 375 pixels.
Executed outcomes are reported on the final PR HEAD after CI and independent Quality review.
