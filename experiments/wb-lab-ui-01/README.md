# WB-LAB-UI-01 — native SVG HMI

**Status:** prepared for owner visual approval. Runtime import and MQTT connection have not been run. The dashboard is a separate, read-only workstream.

## Package

- [`dashboard-desktop.svg`](dashboard-desktop.svg) — 1440 × 900.
- [`dashboard-mobile.svg`](dashboard-mobile.svg) — 420 × 1560 compact layout.
- [`bindings.json`](bindings.json) — shared HomeUI SVG binding array for both files.
- [`bindings.md`](bindings.md) — import mapping and compatibility status.
- [`mqtt-contract.md`](mqtt-contract.md) — controls, types, units, status enums, defaults, cadence, sources, and failure behavior.
- [`demo-publisher.py`](demo-publisher.py) — finite synthetic state sequence with optional host-side MQTT publishing.
- [`telemetry_bridge/`](telemetry_bridge/) — allowlisted status/freshness validation and MQTT transport for DEMO only.
- [`tests/`](tests/) — XML/ID/security/binding and MQTT contract/state checks.
- [`screenshots/`](screenshots/) — desktop and mobile preview captures.

Preview captures:

- [Desktop · 1440 × 900](screenshots/desktop.png)
- [Mobile · 420 × 1560](screenshots/mobile.png)

Every screen carries a clear `DEMO · SYNTHETIC` badge and says live runtime results are not run. The example includes simulated status colors and counts strictly to show the visual states; none proves an E0–E5 experiment. The LIVE source adapter is intentionally absent because PR #54 has not yet produced verified runtime evidence.

## Local preview

Generate the SVG assets and JSON binding file from their source:

```powershell
python -B generate_dashboard.py
```

Print synthetic MQTT-topic changes without connecting to any broker:

```powershell
python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
```

Actual MQTT publishing is opt-in: pass `--host <broker>` explicitly (and, when required, set `WB_MQTT_USERNAME` / `WB_MQTT_PASSWORD`). That publishes a virtual-device namespace to the configured broker. Do not run it against the WB stand until the owner authorizes the broker write. `paho-mqtt` is optional, host-side only, and must not be installed on the WB controller.

## HomeUI version and upload

The dashboard JSON shape is confirmed from the upstream HomeUI SVG editor source. The installed HomeUI version on the WB 8.5.3 stand and actual import behavior remain `NOT_VERIFIED`. Runtime loading is a separate owner approval gate; this task does not touch `/mnt/data/etc/wb-webui.conf`, install packages, modify wb-rules, or alter broker ACLs.

After approval, follow [`bindings.md`](bindings.md) and the current [Wiren Board SVG Dashboards guide](https://wiki.wirenboard.com/wiki/SVG-Dashboards):

1. Before any change, export and back up the existing dashboard SVG and its JSON bindings through the UI.
2. Open **Dashboards → List → Add SVG panel**. Create a unique ID and name.
3. Upload one SVG, import the JSON binding array using **JSON view**, save, and use the built-in preview.
4. Repeat for the other viewport SVG with a different dashboard ID.
5. Open fullscreen/HMI mode and confirm the view is readable on the target desktop and mobile sizes.
6. For revisions, keep each SVG `id` stable, upload the new SVG, and preserve/re-import its binding JSON.
7. To remove only this experiment: delete only the two dashboard IDs created above. Remove only retained `/devices/stdu_lab/...` MQTT topics that appear in this contract, after backing up the topic list and receiving owner approval. Never delete a broader `/devices/#` namespace.

No automatic import is assumed. The documented UI flow is the runbook; no direct configuration-file edit is planned.

## Checks

Run the task-local validations:

```powershell
python -B generate_dashboard.py
python -B -m unittest discover -s tests -v
python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
```

The checks cover XML parsing, stable unique IDs, no external resources/scripts, both viewport bindings, no write actions, allowed MQTT controls, DEMO-only publishing, PASS/FAIL transitions, stale state, offline state, and heartbeat retention. They do not substitute for loading the panel into the controller.

## Limitations / next steps

- No E0–E5 live telemetry source is wired. All demo measurements and outcomes are synthetic.
- The exact installed HomeUI release and editor import are `NOT_VERIFIED` until read-only stand inspection.
- No live broker write, dashboard upload, package install, WB configuration change, or runtime test has been performed.
- Next: visual review of the screenshots; then, when the owner is ready, inspect the exact controller/HomeUI version read-only. Import the dashboard only after separate owner approval.
