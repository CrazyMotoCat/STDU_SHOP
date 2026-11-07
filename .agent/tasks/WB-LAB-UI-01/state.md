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
- No change to WB configuration, software installation, dashboard import, or MQTT publication under this UI task. The accepted E0a physical run was completed and reviewed separately under PR #54; this documentation sync performs no controller operations. Any future HomeUI import or WB MQTT publication requires a separate owner decision.

## Requirements and acceptance

- WB-LAB-UI-01 §§2–10: native SVG Dashboard; desktop and mobile panels; the eight E0a–E5 stage rows; explicit status labels; current run, resources, events and safety indicators; documented MQTT topics, types, units, enums, initial state, cadence, source and missing-data behavior; visible DEMO mode; import/runbook; SVG/contract/binding validation; screenshots.
- Acceptance: unique stable SVG IDs; XML-valid and compact assets; no external scripts/resources; bindings use the documented HomeUI JSON editor shape and contain no write actions; demo sequence exercises RUNNING→PASS and RUNNING→FAIL; telemetry can show FRESH/STALE/NO_DATA and collector ONLINE/OFFLINE/UNKNOWN. E0a Runtime is accepted as `E0A_RUNTIME_PASS` for the linked run only; that evidence must not seed cold-start MQTT/UI values. E0b–E5 remain `NOT_RUN`; `VDS_equivalence` remains `NOT_PROVEN`; dashboard import compatibility remains `NOT_VERIFIED` pending an owner decision.

## Findings before implementation

- Main repository worktree was clean but on stale, deleted `codex/r1-006b-catalog-import`; local `main` matched freshly fetched `origin/main` at the base above.
- Existing `codex/wb-lab-01` worktree is clean and corresponds to Draft PR #54, stacked on VIS-CAT-02C. It is read-only reference and will not be modified.
- Owner-accepted E0a Runtime evidence: `E0A_RUNTIME_PASS`, run `23ceb807c68f4ae0bed724def6e58d68`, `evidence.json` SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`; [acceptance record on PR #54](https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053). The recorded probe reports bounded cgroup resources, loopback-only networking, and confirmed scoped cleanup. The review clarifies `foreign_inventory: PRESERVED` proves identity existence only, not all resource attributes. E0b–E5: `NOT_RUN`; `VDS_equivalence: NOT_PROVEN`. This result is not connected to the UI or MQTT contract.
- Official SVG docs and HomeUI source confirm JSON editor exports an array of per-element binding objects; HomeUI source implements `read`, `style` and `visible`. Read-only SSH inspection on 2026-11-05 verified Debian GNU/Linux 13.7, ARM64, Linux 6.8.0-wb162, and `wb-mqtt-homeui` / `wb-homeui-backend` 2.267.7. Import behavior against that installed build remains NOT_VERIFIED because no dashboard import was attempted.

## Current status

- Owner visual review: PASS; composition approved. Current revision applies the requested cold-start, retained-data, and mobile typography changes without a composition redesign.
- Headless Chromium rendered desktop at 1440px and mobile at 375px; screenshots are at `experiments/wb-lab-ui-01/screenshots/desktop.png` and `mobile.png`.
- Verification for this readiness sync: `python -B generate_dashboard.py` completed; `python -B -m unittest discover -s tests -v` passed 10/10, including neutral cold-start after accepted E0a, E0a evidence link, HomeUI backup/JSON/rollback plan, local-only DEMO plan, all IDs in both SVGs, offline semantics, and mobile type minimum. `python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2` showed the synthetic RUNNING→PASS, RUNNING→FAIL, STALE, then OFFLINE sequence without connecting to a broker.
- Formatting: `pnpm format:check` passed after making generated assets LF-stable and formatting the MQTT contract. It reports a non-failing Node engine warning because local Node is 24.22.1 while the project pins 24.19.0.
- Draft PR: [#55](https://github.com/CrazyMotoCat/STDU_SHOP/pull/55), title `WB-LAB-UI-01: Native Wiren Board SVG HMI`, target `main`. Original implementation commit: `119e39b6aa042448e9f3d8a9c26bf49c95ddb02c`; visual-review correction commit: `3d5c66ac9c8feec2c593caddd25d2371f8f47985`.
- Independent Quality review: PASS after two documentation corrections; no blocking findings remain.
- Prior GitHub checks on `bc0c7e2e134eba1b6573643e0c4e8722a59ce6ba` failed formatting. On readiness HEAD `c5b29786b151a884abdc4905c8ac3116295ddffc`, `FAST CI` PASS (run 42341733060) and `FULL CI` PASS (run 42341733026). The exact-revision `FULL merge gate` failed closed because `main` advanced from PR base `87e2bdf044b51658dc2cca2536fef2c4a38dd1da` to `47e04ee3d808d20c2e2dc341e5c9e1b6e6ed71a0` during checks; the new `main` commit includes unrelated PR #57 and removes this experiment's files. No rebase or merge was attempted; PR #55 remains Draft and merging is prohibited. The generated JSON writer emits stable LF output; local `pnpm format:check` passes with the non-failing local Node engine warning above.
- Controller read-only metadata check: PASS (SSH host ECDSA fingerprint matched the value supplied from the local console; OS and package versions recorded above). E0a/E0b–E5 update above is owner-reported evidence; this task did not rerun a controller preflight. No remote write, install, config change, MQTT publish, or dashboard upload was performed.
- Dashboard import, HMI rendering, and MQTT connection on the controller: NOT_RUN; dashboard upload/import requires separate owner approval.
- Current outcome: `READY_FOR_OWNER_HOMEUI_IMPORT_DECISION`. The agent-prepared HomeUI backup/import/addressed-rollback plan is in `experiments/wb-lab-ui-01/bindings.md`; the isolated local MQTT DEMO plan is in `experiments/wb-lab-ui-01/DEMO-PLAN.md`. Neither plan has been executed against WB.
