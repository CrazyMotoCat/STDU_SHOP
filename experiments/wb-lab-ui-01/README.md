# WB-LAB-UI-01 — native SVG HMI

**Status: verified on the WB test stand with HomeUI 2.267.7.** Desktop and mobile are installed. Both passed cold start, synthetic telemetry transitions, loss of the publisher, and reload. The test data was removed afterward; the panels now show their neutral state.

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
- [`screenshots/`](screenshots/) — desktop and mobile captures from the installed HomeUI after the DEMO publisher disconnected.

HomeUI captures with the last synthetic sample:

- [Desktop · 1440 px browser](screenshots/desktop.png)
- [Mobile · 375 px browser](screenshots/mobile.png)

Every screen keeps a static `DEMO · SYNTHETIC` marker separate from the bound mode value. At cold start or after empty payloads, the panel shows `NO_DATA`, `UNKNOWN`, `NOT_RUN`, and em dashes. The DEMO publisher changes the scenario status and counters and leaves every runtime stage channel untouched. When the collector is offline, the screen identifies retained values as last known and shows the sample age reported at publish time.

## Accepted WB-LAB-01 evidence

**E0a Runtime: `E0A_RUNTIME_PASS`**, accepted by the owner after the physical probe and independent Quality review. The accepted record reports cgroup memory 64 MiB, swap 0, CPU quota 0.25, pids limit 16, loopback-only networking, and confirmed scoped cleanup. Evidence record: run `23ceb807c68f4ae0bed724def6e58d68`, `evidence.json` SHA-256 `3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e`; [owner's technical-acceptance review on PR #54](https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053).

The review limits `foreign_inventory: PRESERVED` to resource-identity existence; it does not verify every foreign resource attribute. This accepted experiment is documentation only: it is not wired to MQTT or the dashboard, and it does not seed `Stage_E0a_Status=PASS`.

**E0b Runtime: `E0B_BLOCKED / E0B_DOCKER_COMMAND_FAILED`**, run `742071b6115e4a00a8b65cc7151f8c39`, cleanup `CONFIRMED`, evidence SHA-256 `dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28`; see the [E0b evidence report](https://github.com/CrazyMotoCat/STDU_SHOP/blob/2f0246c73d25045cf572a350884a441f41383666/experiments/wb-lab-01/RUNTIME-E0B.md). The one authorized attempt is blocked and must not be retried without separate `OWNER_E0B_RUNTIME_APPROVED`. E1–E5 remain `NOT_RUN`; `VDS_equivalence` remains `NOT_PROVEN`. This blocked result is not wired to MQTT or the dashboard and does not seed `Stage_E0b_Status=BLOCKED`.

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

HomeUI 2.267.7 indexes bindings by `device/control` and applies `read.value` even when the cell is missing. The generated expressions return explicit placeholders and escape free text before HomeUI writes it as SVG markup. DEMO publishes numeric payloads as text controls because HomeUI's numeric controls coerce missing values to zero. The expressions add units only to a valid numeric value.

The stand import used HomeUI's per-dashboard API after comparing the original panels against the off-controller backup. Both exported SVG files matched the generated files byte for byte, both exports contained the same 35 read/style bindings, and the original `dashboard1` and `dashboard2` were unchanged. See [the import and rollback procedure](bindings.md). The desktop fits the page; the mobile panel scrolls at full available width.

## Checks

Run the task-local validations:

```powershell
python -B generate_dashboard.py
python -B -m unittest discover -s tests -v
python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
```

The checks cover XML parsing, stable unique IDs, no external resources/scripts, both viewport bindings, no write actions, allowed MQTT controls, DEMO-only publishing, PASS/FAIL transitions, stale state, offline state, and heartbeat retention. They do not substitute for loading the panel into the controller.

## Runtime boundary

E0a and E0b are separately documented lab runs. The HomeUI test did not run any E0a–E5 experiment or attach a LIVE source. `VDS_equivalence` remains `NOT_PROVEN`. The screenshots show the synthetic last-reported snapshot with the collector `OFFLINE`; the approved test removed its own retained entries after capture. The local loopback DEMO procedure remains separate from any future stand publication.
