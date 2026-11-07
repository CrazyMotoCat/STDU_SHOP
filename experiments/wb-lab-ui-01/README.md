# WB-LAB-UI-01 — native SVG HMI

**Status: `READY_FOR_OWNER_HOMEUI_IMPORT_DECISION`.** Desktop/mobile visual review passed. The owner accepted the WB-LAB-01 E0a runtime result; its evidence record is linked below. E0b–E5 remain `NOT_RUN`, and `VDS_equivalence` is `NOT_PROVEN`. No LIVE telemetry source is connected: the dashboard cold start stays neutral and does not inherit the accepted E0a result.

## Package

- [`dashboard-desktop.svg`](dashboard-desktop.svg) — 1440 × 900.
- [`dashboard-mobile.svg`](dashboard-mobile.svg) — 420 × 1560 compact layout.
- [`bindings.json`](bindings.json) — shared HomeUI SVG binding array for both files.
- [`bindings.md`](bindings.md) — import mapping and compatibility status.
- [`mqtt-contract.md`](mqtt-contract.md) — controls, types, units, status enums, defaults, cadence, sources, and failure behavior.
- [`DEMO-PLAN.md`](DEMO-PLAN.md) — separate loopback-only MQTT demonstration plan, isolated from WB and command channels.
- [`demo-publisher.py`](demo-publisher.py) — finite synthetic state sequence with optional host-side MQTT publishing.
- [`telemetry_bridge/`](telemetry_bridge/) — allowlisted status/freshness validation and MQTT transport for DEMO only.
- [`tests/`](tests/) — XML/ID/security/binding and MQTT contract/state checks.
- [`screenshots/`](screenshots/) — desktop and mobile preview captures.

Preview captures:

- [Desktop · 1440 × 900](screenshots/desktop.png)
- [Mobile · 375 px render of the 420 × 1560 SVG](screenshots/mobile.png)

Every screen keeps a static `DEMO · SYNTHETIC` marker separate from the bound mode value, so MQTT text cannot overwrite it. At cold start, the panel shows `NO_DATA`, `UNKNOWN`, `NOT_RUN`, and em dashes; synthetic measurements and statuses appear only after someone explicitly runs the DEMO publisher. Bound status fields are labeled as last reported. When the collector is offline, the screen explains that retained values are last known and sample age is the age reported at publish time, not current collector availability.

## Accepted WB-LAB-01 evidence

**E0a Runtime: `E0A_RUNTIME_PASS`**, accepted by the owner after the physical probe and independent Quality review. The accepted record reports cgroup memory 64 MiB, swap 0, CPU quota 0.25, pids limit 16, loopback-only networking, and confirmed scoped cleanup. Evidence record: run `23ceb807c68f4ae0bed724def6e58d68`, `evidence.json` SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`; [owner's technical-acceptance review on PR #54](https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053).

The review limits `foreign_inventory: PRESERVED` to resource-identity existence; it does not verify every foreign resource attribute. **E0b–E5: `NOT_RUN`. `VDS_equivalence: NOT_PROVEN`.** This accepted experiment is documentation only: it is not wired to MQTT or the dashboard, and it does not seed `Stage_E0a_Status=PASS`.

## Local preview

Generate the SVG assets and JSON binding file from their source:

```powershell
python -B generate_dashboard.py
```

Print synthetic MQTT-topic changes without connecting to any broker:

```powershell
python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
```

Actual MQTT publishing is opt-in. For the separate demo transport check, use only a disposable broker bound to loopback as described in [`DEMO-PLAN.md`](DEMO-PLAN.md); never point it at the WB broker or bridge it to the controller network. Any WB MQTT publication requires separate owner authorization. `paho-mqtt` is optional, host-side only, and must not be installed on the WB controller.

## HomeUI version and upload

Read-only inspection on 2026-11-05 confirmed Debian GNU/Linux 13.7 (ARM64, Linux 6.8.0-wb162) with `wb-mqtt-homeui` and `wb-homeui-backend` version `2.267.7`. The dashboard JSON shape is confirmed from the upstream HomeUI SVG editor source; import behavior against this installed build remains `NOT_VERIFIED` because no dashboard import was attempted. Runtime loading is a separate owner approval gate; this task does not touch `/mnt/data/etc/wb-webui.conf`, install packages, modify wb-rules, or alter broker ACLs.

HomeUI import compatibility for the installed `2.267.7` build remains `NOT_VERIFIED`. The prepared, non-executed backup/import/rollback procedure is in [`bindings.md`](bindings.md). It creates new panel entries, checks retained telemetry before loading, and never edits existing panels or `/mnt/data/etc/wb-webui.conf` directly.

## Checks

Run the task-local validations:

```powershell
python -B generate_dashboard.py
python -B -m unittest discover -s tests -v
python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
```

The checks cover XML parsing, stable unique IDs, no external resources/scripts, both viewport bindings, no write actions, allowed MQTT controls, DEMO-only publishing, PASS/FAIL transitions, stale state, offline state, and heartbeat retention. They do not substitute for loading the panel into the controller.

## Limitations / next steps

- E0a Runtime is accepted as `E0A_RUNTIME_PASS` for the linked run only. It is not a LIVE telemetry source. E0b–E5 remain `NOT_RUN`, and `VDS_equivalence` remains `NOT_PROVEN`.
- The cold-start SVG displays no sample numbers, no `FRESH`, no `PASS`, and no `RUNNING`. Retained MQTT values remain historical/last-known when `Collector_Status=OFFLINE`; HomeUI does not combine these channels into an effective freshness calculation.
- The installed HomeUI release is verified as `2.267.7`; editor import compatibility is `NOT_VERIFIED` until an owner-approved runtime import.
- No dashboard import, WB MQTT publication, package install, or WB configuration change has been performed for this UI task. The E0a result above was accepted separately under PR #54.
- Next status: `READY_FOR_OWNER_HOMEUI_IMPORT_DECISION`; the import plan is prepared but not executed. No LIVE source may be connected under this task.
