#!/usr/bin/env bash
set -euo pipefail
pnpm contract:check
pnpm contract:test
node docs/contracts/check-R1-002.mjs
node --test docs/contracts/check-R1-002.test.mjs
pnpm catalog:contract:check
pnpm catalog:contract:test
node docs/contracts/check-R1-007.mjs
node --test docs/contracts/check-R1-007.test.mjs
pnpm supplier:contract:check
node docs/contracts/check-R1-010.mjs
node --test docs/contracts/check-R1-010.test.mjs
node scripts/validate-openapi.mjs docs/contracts/R1-010-inquiries.openapi.json
pnpm inquiry:contract:check
generated=$(mktemp --suffix=.d.ts)
trap 'rm -f "$generated"' EXIT
pnpm exec openapi-typescript docs/contracts/R1-010-inquiries.openapi.json --output "$generated"
pnpm exec openapi-typescript docs/contracts/R1-010-inquiries.openapi.json --output "$generated" --check
pnpm r1-010d:contract:check
pnpm r1-010d:contract:test
node .agent/tasks/R1-004B/verify-contract-lock.mjs
