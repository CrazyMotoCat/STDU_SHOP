# WB-LAB-UI-01 — native SVG HMI

**Status:** owner visual review and independent Quality review passed; cold-start, retained-data, and mobile-readability corrections are applied without changing the approved composition. FAST CI and FULL CI passed for correction commit `3d5c66ac9c8feec2c593caddd25d2371f8f47985`. Runtime import and MQTT connection have not been run. The dashboard is a separate, read-only workstream.

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
- [Mobile · 375 px render of the 420 × 1560 SVG](screenshots/mobile.png)

Every screen keeps a static `DEMO · SYNTHETIC` marker separate from the bound mode value, so MQTT text cannot overwrite it. At cold start, the panel shows `NO_DATA`, `UNKNOWN`, `NOT_RUN`, and em dashes; synthetic measurements and statuses appear only after someone explicitly runs the DEMO publisher. Bound status fields are labeled as last reported. When the collector is offline, the screen explains that retained values are last known and sample age is the age reported at publish time, not current collector availability.

Latest WB-LAB-01 evidence, as supplied by the owner: **E0a Host Metadata PASS** on the real WB; **E0a Runtime BLOCKED: `LOCAL_IMAGE_ID`**; no container or volume was created in that attempt; **E0b–E5 NOT_RUN**. This partial host metadata result is not runtime experiment evidence and is not wired into the synthetic dashboard.

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

Read-only inspection on 2026-11-05 confirmed Debian GNU/Linux 13.7 (ARM64, Linux 6.8.0-wb162) with `wb-mqtt-homeui` and `wb-homeui-backend` version `2.267.7`. The dashboard JSON shape is confirmed from the upstream HomeUI SVG editor source; import behavior against this installed build remains `NOT_VERIFIED` because no dashboard import was attempted. Runtime loading is a separate owner approval gate; this task does not touch `/mnt/data/etc/wb-webui.conf`, install packages, modify wb-rules, or alter broker ACLs.

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

- E0a host metadata has a reported PASS, while runtime is blocked at `LOCAL_IMAGE_ID`; no container or volume was created. E0b–E5 remain `NOT_RUN`. No runtime telemetry source is wired; all DEMO measurements and outcomes are synthetic.
- The cold-start SVG displays no sample numbers, no `FRESH`, no `PASS`, and no `RUNNING`. Retained MQTT values remain historical/last-known when `Collector_Status=OFFLINE`; HomeUI does not combine these channels into an effective freshness calculation.
- The installed HomeUI release is verified as `2.267.7`; editor import compatibility is `NOT_VERIFIED` until an owner-approved runtime import.
- No live broker write, dashboard upload, package install, WB configuration change, or runtime test has been performed.
- Next: complete fresh PR checks. Import the dashboard only after separate owner approval.
