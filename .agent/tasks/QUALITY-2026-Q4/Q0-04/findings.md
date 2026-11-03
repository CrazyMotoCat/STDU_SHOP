# QUALITY-2026-Q4 — Q0-04 findings and scope

**Task:** Q0-04 — CSV delimiter, Boolean, and SKU semantics
**Base:** `origin/main` `336ec8ed82224748e8d2b76bd9a049ee7fb38fbb`
**Mode:** `REVIEW_REQUIRED / DRAFT_PR / NO_MERGE`
**Finding evidence:** synthetic parser/runtime reproducers; no claim of production data corruption.

## Requirement trace

- `CAT-05`, `SRC-05`, `SPEC-01`, `SPEC-02`; backlog `R1-006`, `R1-008`, `R1-011`; acceptance `E2E-03`, `E2E-07`, `E2E-19`; decisions #6, #25, #27, #62.
- Python returns staged source values; NestJS owns candidate normalization, preview state, identity matching, and writes. Manual review and individual approval gates remain unchanged.
- Source lineage must remain inspectable from `SOURCE → PARSER VALUE → NORMALIZED CANDIDATE → PREVIEW → PRODUCT IDENTITY`.

## Revalidated root causes at the task base

### AUD-010 — CSV delimiter detection

- Python `_detect_delimiter()` and Nest `delimiterFrom()` count literal comma, semicolon, and TAB characters in the first 25 physical lines. Delimiters inside quoted and escaped fields affect the result.
- Nest chooses a delimiter before calling Python and passes it as an explicit parser header, so fixing only Python would leave the staff upload path incorrect.
- Existing explicit delimiter validation and UTF-8 / Windows-1251 selection are retained. Ambiguous auto-detection must return the existing controlled `ENCODING_REQUIRED` error; it must not choose by candidate order.

### AUD-021 — typed XLSX Boolean cells

- Python already emits XLSX Boolean cells as `cellType: BOOLEAN` with OOXML raw values `1` or `0`; the internal parser protocol already carries the cell type.
- Nest Boolean attribute normalization accepts text `true` / `false` only, so typed XLSX Boolean cells currently become `INVALID_BOOLEAN`.
- Map only `BOOLEAN` + raw `1`/`0` to true/false. Continue accepting text `true`/`false`; do not coerce `TEXT` or `NUMBER` `1`/`0`, and do not introduce false defaults.

### AUD-024 — numeric SKU coercion

- The existing internal source cell already carries optional `numberFormat`; an all-zero Excel format can preserve explicitly displayed leading zeroes.
- `normalizeImportRow()` applies JavaScript `Number()` to numeric SKU raw text before checking that the number is safe and the format is an all-zero mask. Safe values such as `1e3` and `0x10` can therefore be reinterpreted as numeric identifiers when the format mask is zero-only.
- Preserve text identifiers verbatim (apart from existing NFC/edge-space identity handling). For numeric XLSX identity, accept only a plain safe integer with an explicit all-zero format; reject exponent/hex/decimal/unsafe forms. Do not change SKU grammar, alter existing catalog rows, or auto-repair historical data.

## Implementation response

- Delimiter inference now scans quote-aware logical records, caps evidence at 25 nonempty records, scores repeated field widths, and returns the existing controlled ambiguity error on ties. Nest decodes the sample using the declared CSV encoding and uses a whitespace set matching Python `str.isspace()`, including NEL; the mixed-dialect NEL regression selects `;` and yields a controlled `MALFORMED_CSV` result instead of silently importing semicolon rows as one column.
- Parser, FastAPI, and Nest runtime fixtures prove records after the 25-record sample do not change the inferred delimiter.
- Boolean normalization accepts `BOOLEAN` raw `1`/`0` and `TEXT` `true`/`false`; `NUMBER` or other text/numeric forms remain invalid.
- Numeric SKU source must be plain digits, safe integer, and all-zero number format. Text SKU remains text. A `LEADING_ZEROES_RESTORED` warning is emitted only when padding adds digits.
- Preview proof checks exact identity and confirms no `ProductRevision`, `ImportDecision`, or `catalog.product.revision.created` event is added.
- Synthetic fixtures only; no production data-corruption claim.

## Synthetic acceptance examples

- CSV: delimiters inside quoted fields, escaped double quotes, multiline quotes, CRLF/LF, UTF-8 BOM, Windows-1251, empty fields, a short last record, a one-column file, tied/ambiguous candidates, explicit override, and malformed quoting.
- XLSX: typed Boolean `1` and `0`; text `true`, `false`, `1`, `0`; text SKU `00123`, `1e3`, `0x10`, and hyphenated values; numeric SKU with `00000` format; numeric exponent/hex/unsafe representations.
- Runtime preview must preserve source cells, produce the expected normalized values/issues, and deduplicate only by the exact existing product identity tuple. Preview must create no product revision or row decision; its normal upload/mapping/preview audit records remain expected.

## Exclusions

AUD-005/016/030, CLEAN/R1-010D, parser worker/verifier, Supplier Idempotency, Staff UI races, product/catalog facets, broad parser performance work, supplier imports, migrations, OpenAPI, shared DTO, auth/RBAC, and production data or services.
