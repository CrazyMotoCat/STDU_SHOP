from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from telemetry_bridge.contract import (  # noqa: E402
    CONTROL_SCHEMA,
    DEFAULTS,
    STAGE_CODES,
    classify_freshness,
    collector_state,
    control_topic,
    demo_frame,
    mqtt_messages,
    validate_demo_frame,
)


class ContractTests(unittest.TestCase):
    def test_demo_transitions_running_to_pass_and_fail(self) -> None:
        instant = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
        started = demo_frame(0, now=instant, collector_connected=True)
        passed = demo_frame(1, now=instant, collector_connected=True)
        second_started = demo_frame(2, now=instant, collector_connected=True)
        failed = demo_frame(3, now=instant, collector_connected=True)

        self.assertEqual((started["Status"], started["Stage_E0a_Status"]), ("RUNNING", "RUNNING"))
        self.assertEqual((passed["Status"], passed["Stage_E0a_Status"], passed["Passed"]), ("PASS", "PASS", 1))
        self.assertEqual((second_started["Status"], second_started["Stage_E0b_Status"]), ("RUNNING", "RUNNING"))
        self.assertEqual((failed["Status"], failed["Stage_E0b_Status"], failed["Failed"]), ("FAIL", "FAIL", 1))
        self.assertTrue(all(frame["Source_Mode"] == "DEMO" for frame in (started, passed, second_started, failed)))

    def test_freshness_and_collector_states(self) -> None:
        self.assertEqual(classify_freshness(15), "FRESH")
        self.assertEqual(classify_freshness(15.01), "STALE")
        self.assertEqual(classify_freshness(None), "NO_DATA")
        self.assertEqual(classify_freshness(-1), "NO_DATA")
        self.assertEqual(collector_state(True), "ONLINE")
        self.assertEqual(collector_state(False), "OFFLINE")
        self.assertEqual(collector_state(None), "UNKNOWN")
        self.assertEqual(demo_frame(4, collector_connected=True)["Telemetry_State"], "STALE")

    def test_demo_adapter_rejects_live_or_unknown_payloads(self) -> None:
        live = demo_frame(0)
        live["Source_Mode"] = "LIVE"
        with self.assertRaisesRegex(ValueError, "DEMO frames only"):
            validate_demo_frame(live)

        unknown_control = demo_frame(0)
        unknown_control["Delete"] = "anything"
        with self.assertRaisesRegex(ValueError, "fields differ"):
            validate_demo_frame(unknown_control)

        secret_like = demo_frame(0)
        secret_like["Last_Error"] = "token=example"
        with self.assertRaisesRegex(ValueError, "secret-like"):
            validate_demo_frame(secret_like)

    def test_topics_are_read_only_and_heartbeat_is_not_retained(self) -> None:
        messages = mqtt_messages(demo_frame(0, collector_connected=True))
        topic_map = {topic: (payload, retained) for topic, payload, retained in messages}
        self.assertEqual(len(topic_map), len(messages))
        for name in CONTROL_SCHEMA:
            root = control_topic(name)
            self.assertIn(root, topic_map)
            self.assertIn((f"{root}/meta/readonly", "1", True), messages)
            self.assertFalse(any(topic.startswith(f"{root}/on") for topic, _payload, _retained in messages))
            retained = topic_map[root][1]
            self.assertEqual(retained, name != "Heartbeat")
        self.assertEqual(len([name for name in CONTROL_SCHEMA if name.startswith("Stage_")]), len(STAGE_CODES))

    def test_defaults_do_not_claim_runtime_success(self) -> None:
        self.assertEqual(DEFAULTS["Source_Mode"], "DEMO")
        self.assertEqual(DEFAULTS["Telemetry_State"], "NO_DATA")
        self.assertEqual(DEFAULTS["Collector_Status"], "OFFLINE")
        self.assertEqual(DEFAULTS["Unknown_Cleanup"], "UNKNOWN")
        self.assertEqual(DEFAULTS["Runtime_Blocked"], "ACTIVE")
        self.assertTrue(all(DEFAULTS[f"Stage_{code}_Status"] == "NOT_RUN" for code in STAGE_CODES))


if __name__ == "__main__":
    unittest.main()
