# WB-LAB-UI-01 checkpoint

## Task and delivery

- Task: native Wiren Board SVG HMI dashboard and read-only telemetry contract.
- Tier: T2 visual/UI plus isolated telemetry adapter; no shared API, schema, permissions, business state, or production code.
- Delivery mode: Draft PR only, no merge, per task brief.
- Original base: `87e2bdf044b51658dc2cca2536fef2c4a38dd1da`. Synchronized with `origin/main` at `47e04ee3d808d20c2e2dc341e5c9e1b6e6ed71a0` by normal merge commit `be601e172d964ef98faff865a8b1dd7c1f2d914d`; feature/main changed-path intersection was empty.
- Worktree: `C:\Users\mvideo\.codex\worktrees\wb-lab-ui-01`, branch `codex/wb-lab-ui-01`.

## Frozen scope

- All artifacts stay under `experiments/wb-lab-ui-01/` plus this checkpoint.
- Read-only SVG bindings only; MQTT telemetry values only; no subscriptions to command topics and no `/on` channels.
- DEMO is synthetic and explicitly labeled; no simulated state is evidence for runtime E0–E5.
- No edits to PR #49, #52, #53, #54, production frontend, PostgreSQL, storage/recovery, ClamAV, OPS-TEST-02, or `wb-mqtt-homeui`.
- No change to WB configuration, software installation, dashboard import, or MQTT publication under this UI task. The accepted E0a physical run was completed and reviewed separately under PR #54; this documentation sync performs no controller operations. Any future HomeUI import or WB MQTT publication requires a separate owner decision.

## Requirements and acceptance

- WB-LAB-UI-01 §§2–10: native SVG Dashboard; desktop and mobile panels; the eight E0a–E5 stage rows; explicit status labels; current run, resources, events and safety indicators; documented MQTT topics, types, units, enums, initial state, cadence, source and missing-data behavior; visible DEMO mode; import/runbook; SVG/contract/binding validation; screenshots.
- Acceptance: unique stable SVG IDs; XML-valid and compact assets; no external scripts/resources; bindings use the documented HomeUI JSON editor shape and contain no write actions; demo sequence exercises RUNNING→PASS and RUNNING→FAIL; telemetry can show FRESH/STALE/NO_DATA and collector ONLINE/OFFLINE/UNKNOWN. E0a is `E0A_RUNTIME_PASS / OWNER ACCEPTED` for its linked run only; E0b is `E0B_BLOCKED / E0B_DOCKER_COMMAND_FAILED`, cleanup `CONFIRMED`, for its linked run only. Neither run seeds cold-start MQTT/UI values. E1–E5 remain `NOT_RUN`; `VDS_equivalence` remains `NOT_PROVEN`; dashboard import compatibility remains `NOT_VERIFIED` pending `OWNER_HOMEUI_IMPORT_APPROVED`.

## Findings before implementation

- Main repository worktree was clean but on stale, deleted `codex/r1-006b-catalog-import`; local `main` matched freshly fetched `origin/main` at the base above.
- Existing `codex/wb-lab-01` worktree is clean and corresponds to Draft PR #54, stacked on VIS-CAT-02C. It is read-only reference and will not be modified.
- Owner-accepted E0a Runtime evidence: `E0A_RUNTIME_PASS`, run `23ceb807c68f4ae0bed724def6e58d68`, `evidence.json` SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`; [acceptance record on PR #54](https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053). The recorded probe reports bounded cgroup resources, loopback-only networking, and confirmed scoped cleanup. The review clarifies `foreign_inventory: PRESERVED` proves identity existence only, not all resource attributes.
- Latest WB-LAB-01 E0b status: `E0B_BLOCKED / E0B_DOCKER_COMMAND_FAILED`, run `742071b6115e4a00a8b65cc7151f8c39`, cleanup `CONFIRMED`, evidence SHA-256 `dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28`; [E0b report](https://github.com/CrazyMotoCat/STDU_SHOP/blob/2f0246c73d25045cf572a350884a441f41383666/experiments/wb-lab-01/RUNTIME-E0B.md). Do not retry E0b without separate `OWNER_E0B_RUNTIME_APPROVED`. E1–E5: `NOT_RUN`; `VDS_equivalence: NOT_PROVEN`. E0a PASS/E0b BLOCKED are not wired into this dashboard.
- Read-only SSH inspection on 2026-11-07 reconfirmed `wb-mqtt-homeui` and `wb-homeui-backend` 2.267.7. The installed editor assets `edit-D4B0_nFh.js` and `json-bindings-editor-DcsGwJjc.js` were inspected; they serialize binding `params` with `JSON.stringify` and parse JSON input with `JSON.parse`. The generated array matches that editor input syntax, but the editor does not validate schema. No UI export/import or panel render was attempted; actual import/render remains `NOT_VERIFIED`.

## Current status

- Owner visual review: PASS; composition approved. Current revision applies the requested cold-start, retained-data, and mobile typography changes without a composition redesign.
- Headless Chromium rendered desktop at 1440px and mobile at 375px; screenshots are at `experiments/wb-lab-ui-01/screenshots/desktop.png` and `mobile.png`.
- Post-base-sync targeted verification on this documentation update: `python -B generate_dashboard.py` exited 0; `python -B -m unittest discover -s tests -v` passed 11/11; `python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2` completed six synthetic steps through RUNNING→PASS, RUNNING→FAIL, STALE and OFFLINE without connecting to a broker; `pnpm format:check` and `git diff --check` passed. Local Node 24.22.1 emitted the known non-failing engine warning against the pinned 24.19.0. The desktop/mobile SVG and bindings SHA-256 values match the pre-sync visual package; no screenshot regeneration was needed.
- Formatting: `pnpm format:check` passed after making generated assets LF-stable and formatting the MQTT contract. It reports a non-failing Node engine warning because local Node is 24.22.1 while the project pins 24.19.0.
- Draft PR: [#55](https://github.com/CrazyMotoCat/STDU_SHOP/pull/55), title `WB-LAB-UI-01: Native Wiren Board SVG HMI`, target `main`. Original implementation commit: `119e39b6aa042448e9f3d8a9c26bf49c95ddb02c`; visual-review correction commit: `3d5c66ac9c8feec2c593caddd25d2371f8f47985`.
- Independent Quality review for the E0b/status/base update: pending final HEAD.
- Earlier exact-HEAD FAST/FULL runs passed before the base update; the previous merge gate failed closed on stale base. Normal base synchronization commit `be601e172d964ef98faff865a8b1dd7c1f2d914d` brought in only the five disjoint PR #57 files and preserved all task files. Fresh exact-HEAD FAST/FULL/merge-gate checks are pending.
- Controller read-only metadata check: PASS (SSH host ECDSA fingerprint matched the value supplied from the local console; installed HomeUI versions recorded above). The persisted config contains two dashboards (`dashboard1`, `dashboard2`); neither target panel ID collides. An exact `/devices/stdu_lab/controls/+` subscription was accepted, with no messages returned during the five-second retained-value check. These preflight observations must be repeated before a future import. E0a/E0b outcomes above are owner-provided evidence; this task did not rerun either experiment. No remote write, install, config change, MQTT publish, or dashboard upload was performed.
- The `codex/wb-lab-ui-01` branch was synchronized with the fetched `origin/main` by a normal merge. No other worktree was modified; only the read-only WB diagnostics above were run.
- Dashboard import, HMI rendering, and MQTT connection on the controller: NOT_RUN; dashboard upload/import requires separate owner approval.
- Current outcome: `READY_FOR_OWNER_HOMEUI_IMPORT_APPROVAL`. The agent-prepared HomeUI backup/import/addressed-rollback plan is in `experiments/wb-lab-ui-01/bindings.md`; the isolated local MQTT DEMO plan is in `experiments/wb-lab-ui-01/DEMO-PLAN.md`. Neither plan has been executed against WB. Stop until the exact separate owner approval `OWNER_HOMEUI_IMPORT_APPROVED` is received.
