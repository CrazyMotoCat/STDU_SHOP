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
- Acceptance: unique stable SVG IDs; XML-valid and compact assets; no external scripts/resources; bindings use the documented HomeUI JSON editor shape and contain no write actions; demo sequence exercises RUNNING→PASS and RUNNING→FAIL; telemetry can show FRESH/STALE/NO_DATA and collector ONLINE/OFFLINE/UNKNOWN. Read-only controller access and installed versions are verified; dashboard import compatibility remains NOT_VERIFIED pending owner approval.

## Findings before implementation

- Main repository worktree was clean but on stale, deleted `codex/r1-006b-catalog-import`; local `main` matched freshly fetched `origin/main` at the base above.
- Existing `codex/wb-lab-01` worktree is clean and corresponds to Draft PR #54, stacked on VIS-CAT-02C. It is read-only reference and will not be modified.
- E0a Host Metadata: PASS on the real WB controller. E0a Runtime: BLOCKED at `LOCAL_IMAGE_ID`; no container or volume was created in that attempt. E0b–E5: NOT_RUN. No reliable LIVE runtime telemetry source is available. DEMO is the only implemented source in this task.
- Official SVG docs and HomeUI source confirm JSON editor exports an array of per-element binding objects; HomeUI source implements `read`, `style` and `visible`. Read-only SSH inspection on 2026-11-05 verified Debian GNU/Linux 13.7, ARM64, Linux 6.8.0-wb162, and `wb-mqtt-homeui` / `wb-homeui-backend` 2.267.7. Import behavior against that installed build remains NOT_VERIFIED because no dashboard import was attempted.

## Current status

- Owner visual review: PASS; composition approved. Current revision applies the requested cold-start, retained-data, and mobile typography changes without a composition redesign.
- Headless Chromium rendered desktop at 1440px and mobile at 375px; screenshots are at `experiments/wb-lab-ui-01/screenshots/desktop.png` and `mobile.png`.
- Verification: `python -B generate_dashboard.py` completed; `python -B -m unittest discover -s tests -v` passed 7/7, including cold-start neutral state, fixed DEMO marker, all IDs in both SVGs, snapshot-age/collector separation, and mobile type minimum. `python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2` showed the explicit synthetic sequence RUNNING→PASS, RUNNING→FAIL, STALE, then OFFLINE without broker connection.
- Formatting: `pnpm format:check` passed after making generated assets LF-stable and formatting the MQTT contract. It reports a non-failing Node engine warning because local Node is 24.22.1 while the project pins 24.19.0.
- Draft PR: [#55](https://github.com/CrazyMotoCat/STDU_SHOP/pull/55), title `WB-LAB-UI-01: Native Wiren Board SVG HMI`, target `main`. Original implementation commit: `119e39b6aa042448e9f3d8a9c26bf49c95ddb02c`; visual-review correction commit: `3d5c66ac9c8feec2c593caddd25d2371f8f47985`.
- Independent Quality review: PASS after two documentation corrections; no blocking findings remain.
- Prior GitHub checks on `bc0c7e2e134eba1b6573643e0c4e8722a59ce6ba` failed formatting. On correction commit `3d5c66ac9c8feec2c593caddd25d2371f8f47985`, `FAST CI` PASS (run 42037690976) and `FULL CI` PASS (run 42037690955); an earlier overlapping run was cancelled when the PR edit event started these newer runs. The generated JSON writer now emits stable LF output; local `pnpm format:check` passes.
- Controller read-only metadata check: PASS (SSH host ECDSA fingerprint matched the value supplied from the local console; OS and package versions recorded above). E0a/E0b–E5 update above is owner-reported evidence; this task did not rerun a controller preflight. No remote write, install, config change, MQTT publish, or dashboard upload was performed.
- Dashboard import, HMI rendering, and MQTT connection on the controller: NOT_RUN; dashboard upload/import requires separate owner approval.
