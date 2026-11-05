# WB-LAB-UI-01 checkpoint

## Task and delivery

- Task: native Wiren Board SVG HMI dashboard and read-only telemetry contract.
- Tier: T2 visual/UI plus isolated telemetry adapter; no shared API, schema, permissions, business state, or production code.
- Delivery mode: Draft PR only, no merge, per task brief.
- Base: `origin/main` at `87e2bdf044b51658dc2cca2536fef2c4a38dd1da` (fetched 2026-11-05; fast-forwarded after five disjoint catalog-only commits).
- Worktree: `C:\Users\mvideo\.codex\worktrees\wb-lab-ui-01`, branch `codex/wb-lab-ui-01`.

## Frozen scope

- All artifacts stay under `experiments/wb-lab-ui-01/` plus this checkpoint.
- Read-only SVG bindings only; MQTT telemetry values only; no subscriptions to command topics and no `/on` channels.
- DEMO is synthetic and explicitly labeled; no simulated state is evidence for runtime E0–E5.
- No edits to PR #49, #52, #53, #54, production frontend, PostgreSQL, storage/recovery, ClamAV, OPS-TEST-02, or `wb-mqtt-homeui`.
- No changes to WB configuration, no software install, no test execution on the controller, and no dashboard upload until separate owner approval.

## Requirements and acceptance

- WB-LAB-UI-01 §§2–10: native SVG Dashboard; desktop and mobile panels; the eight E0a–E5 stage rows; explicit status labels; current run, resources, events and safety indicators; documented MQTT topics, types, units, enums, initial state, cadence, source and missing-data behavior; visible DEMO mode; import/runbook; SVG/contract/binding validation; screenshots.
- Acceptance: unique stable SVG IDs; XML-valid and compact assets; no external scripts/resources; bindings follow verified HomeUI JSON editor shape and contain no write actions; demo sequence exercises RUNNING→PASS and RUNNING→FAIL; telemetry can show FRESH/STALE/NO_DATA and collector ONLINE/OFFLINE/UNKNOWN; runtime connection remains NOT_VERIFIED pending board access.

## Findings before implementation

- Main repository worktree was clean but on stale, deleted `codex/r1-006b-catalog-import`; local `main` matched freshly fetched `origin/main` at the base above.
- Existing `codex/wb-lab-01` worktree is clean and corresponds to Draft PR #54, stacked on VIS-CAT-02C. It is read-only reference and will not be modified.
- PR #54 README reports no runtime preflight/experiments yet; no reliable LIVE telemetry source is available. DEMO is the only implemented source in this task.
- Official SVG docs and HomeUI source confirm JSON editor exports an array of per-element binding objects; HomeUI source implements `read`, `style` and `visible`. Exact installed package version on the WB remains NOT_VERIFIED until read-only inspection.

## Current status

- Ready for owner visual approval: desktop/mobile SVGs, HomeUI binding array, MQTT contract, DEMO-only publisher, tests, screenshots, and UI runbook are prepared under the isolated experiment directory.
- Headless Chromium rendered both SVGs; screenshots are at `experiments/wb-lab-ui-01/screenshots/desktop.png` and `mobile.png`.
- Verification: `python -B generate_dashboard.py` completed; `python -B -m unittest discover -s tests -v` passed 6/6; `python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2` showed synthetic RUNNING→PASS, RUNNING→FAIL, STALE, then OFFLINE without broker connection.
- Draft PR: not created yet.
- Runtime import/stand checks: NOT_RUN; require owner access and separate approval for upload.
