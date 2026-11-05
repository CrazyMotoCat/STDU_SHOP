#!/usr/bin/env python3
"""Emit synthetic STDU lab telemetry as JSON or, when explicitly configured, MQTT."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from telemetry_bridge.contract import control_topic, demo_frame, mqtt_messages


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="MQTT broker host; omitted means dry-run")
    parser.add_argument("--port", type=int, default=int(os.getenv("WB_MQTT_PORT", "1883")))
    parser.add_argument("--tls", action="store_true", help="use broker TLS with system trust roots")
    parser.add_argument("--steps", type=int, default=6, help="number of snapshots; always finite")
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    parser.add_argument("--dry-run", action="store_true", help="print synthetic MQTT messages without connecting")
    return parser.parse_args()


def dry_run(steps: int, interval_seconds: float) -> None:
    previous: dict[str, str] = {}
    for step in range(steps):
        frame = demo_frame(step, collector_connected=None)
        changes: dict[str, str] = {}
        for topic, payload, _retained in mqtt_messages(frame):
            if topic.startswith(f"{control_topic('Source_Mode')}/meta/") or "/meta/" in topic:
                continue
            if topic not in previous or previous[topic] != payload:
                changes[topic] = payload
            previous[topic] = payload
        print(json.dumps({"step": step, "mode": "DEMO", "changes": changes}, ensure_ascii=False, sort_keys=True))
        if step + 1 < steps:
            time.sleep(interval_seconds)
    print(json.dumps({"final_state": {control_topic("Collector_Status"): "OFFLINE"}, "reason": "publisher stopped"}, ensure_ascii=False))


def main() -> int:
    args = parse_args()
    if args.steps < 1 or args.interval_seconds < 0.2 or not 1 <= args.port <= 65535:
        raise SystemExit("steps, interval, or MQTT port is outside its allowed range")
    if args.dry_run or not args.host:
        dry_run(args.steps, args.interval_seconds)
        return 0

    from telemetry_bridge.publisher import DemoMqttPublisher

    publisher = DemoMqttPublisher(
        args.host,
        args.port,
        username=os.getenv("WB_MQTT_USERNAME"),
        password=os.getenv("WB_MQTT_PASSWORD"),
        tls=args.tls,
    )
    try:
        publisher.run(steps=args.steps, interval_seconds=args.interval_seconds)
    except (ConnectionError, OSError, RuntimeError, TimeoutError, ValueError) as exc:
        # Do not print environment variables, passwords, or broker credentials.
        print(f"DEMO MQTT publish failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
