# Isolated DEMO MQTT verification plan

**Status:** prepared, not executed. The scope is local synthetic telemetry only; it is not an E0a–E5 experiment and cannot set a runtime result.

## Isolation requirements

- Use a disposable MQTT broker bound to `127.0.0.1` on a task-specific port. Do not bridge it to another broker or connect it to the controller network.
- Do not use WB broker credentials or WB hostnames/addresses. Do not publish any MQTT message to WB.
- Use `demo-publisher.py` only in explicit `DEMO` mode. It does not subscribe to MQTT.
- Permit only exact allowlisted value and `/meta` topics from `telemetry_bridge.contract.CONTROL_SCHEMA`. Do not subscribe to `/devices/#`, `controls/+/on`, or any command topic. Do not grant write ACLs for `/on` channels.
- Start with an ephemeral broker store and discard it after the run. Retained demo values must not survive into later sessions or be copied to WB.

## Procedure after local test-broker availability

1. First run the non-publishing preview:

   ```powershell
   python -B demo-publisher.py --dry-run --steps 6 --interval-seconds 0.2
   ```

   Check that every emitted topic is in the documented `stdu_lab` value/metadata allowlist and no topic ends in `/on`.

2. Start the disposable broker bound only to loopback, with no persistence, bridge, external listener, or WB credentials. Confirm the listener is `127.0.0.1` before the client starts.
3. Subscribe only to the explicit value and metadata topics listed in `mqtt-contract.md`. Do not subscribe to a wildcard that includes command channels.
4. In a separate local process, publish a finite sequence to that broker only:

   ```powershell
   python -B demo-publisher.py --host 127.0.0.1 --port 18883 --steps 6 --interval-seconds 1
   ```

   The port is for the disposable local broker; change it only if the task-owned listener uses another local port.

5. Verify `Source_Mode=DEMO`, the synthetic RUNNING/PASS and RUNNING/FAIL transitions, retained last-reported values, non-retained heartbeat, and OFFLINE on publisher shutdown. Verify no command-channel subscription or publication occurred.
6. Stop and discard the disposable broker. Record the command, listener address, observed topic allowlist, and result as `DEMO_TRANSPORT_ONLY`; do not copy this status into `Stage_E0a_Status` or any other runtime evidence.

## Stop conditions

Stop without publishing if the broker is not loopback-only, has a bridge or external listener, the publisher requires a WB credential, any topic is outside the contract, or any `/on`/command topic appears. Do not try to clean up by writing to WB; this plan has no WB cleanup step.

The accepted E0a evidence is separately documented in the [owner technical-acceptance review on PR #54](https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053). This DEMO plan does not affect that result.
