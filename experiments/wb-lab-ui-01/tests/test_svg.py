from __future__ import annotations

import json
import sys
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from telemetry_bridge.contract import CONTROL_SCHEMA, STAGE_CODES  # noqa: E402

SVG_NS = "{http://www.w3.org/2000/svg}"


class DashboardAssetTests(unittest.TestCase):
    def test_svg_documents_are_valid_compact_and_self_contained(self) -> None:
        ids_by_file = {}
        elements_by_file = {}
        text_by_file = {}
        for name, expected_box in (("dashboard-desktop.svg", "0 0 1440 900"), ("dashboard-mobile.svg", "0 0 420 1560")):
            path = ROOT / name
            markup = path.read_text(encoding="utf-8")
            root = ET.fromstring(markup)
            self.assertEqual(root.tag, f"{SVG_NS}svg")
            self.assertEqual(root.attrib.get("viewBox"), expected_box)
            ids = [element.attrib["id"] for element in root.iter() if "id" in element.attrib]
            self.assertEqual(len(ids), len(set(ids)), f"duplicate SVG id in {name}")
            ids_by_file[name] = set(ids)
            elements_by_file[name] = {element.attrib["id"]: element for element in root.iter() if "id" in element.attrib}
            text_by_file[name] = "".join(root.itertext())
            self.assertLess(path.stat().st_size, 30_000)
            self.assertNotIn("<script", markup.casefold())
            self.assertNotIn("foreignobject", markup.casefold())
            for element in root.iter():
                self.assertFalse(any(key.casefold().startswith("on") for key in element.attrib))
                for attr in ("href", f"{SVG_NS}href"):
                    value = element.attrib.get(attr)
                    self.assertFalse(value and (value.startswith("http:") or value.startswith("https:") or value.startswith("//")))
            self.assertIn("DEMO", "".join(root.itertext()))
            self.assertIn("NOT RUN", "".join(root.itertext()))
            if name == "dashboard-mobile.svg":
                mobile_text_sizes = [int(element.attrib["font-size"]) for element in root.iter() if element.tag == f"{SVG_NS}text"]
                self.assertGreaterEqual(min(mobile_text_sizes), 9, "mobile labels must remain legible at 375px width")

        bindings = json.loads((ROOT / "bindings.json").read_text(encoding="utf-8"))
        self.assertIsInstance(bindings, list)
        self.assertEqual(len(bindings), len({entry["id"] for entry in bindings}))
        for name in ("dashboard-desktop.svg", "dashboard-mobile.svg"):
            for entry in bindings:
                self.assertIn(entry["id"], ids_by_file[name])
        for entry in bindings:
            self.assertLessEqual(set(entry), {"id", "read", "style"})
            self.assertIn("read", entry)
            self.assertNotIn("write", entry)
            self.assertNotIn("click", entry)
            self.assertNotIn("long-press-write", entry)
            for action in ("read", "style"):
                if action in entry:
                    rule = entry[action]
                    self.assertTrue(rule["enable"])
                    self.assertIn("channel", rule)
                    control = rule["channel"].rsplit("/", maxsplit=1)[-1]
                    self.assertIn(control, CONTROL_SCHEMA)
        self.assertEqual(set(binding["id"] for binding in bindings), {
            "dash_mode", "dash_controller_status", "dash_clock", "dash_run_id", "dash_stage",
            "dash_current_test", "dash_run_status", "dash_progress", "dash_elapsed", "dash_last_update",
            "dash_passed", "dash_failed", "dash_ram_available", "dash_cpu_load", "dash_disk_free",
            "dash_swap_used", "dash_container_peak", "dash_pg_status", "dash_docker_status",
            "dash_last_event", "dash_last_error", "dash_event_time", "dash_snapshot_age",
            "dash_collector_status", "dash_limit_exceeded", "dash_unknown_cleanup", "dash_runtime_blocked",
            "dash_stage_E0a_status", "dash_stage_E0b_status", "dash_stage_E1_status", "dash_stage_E2_status",
            "dash_stage_E3_status", "dash_stage_E3b_status", "dash_stage_E4a_status", "dash_stage_E5_status",
        })

        bound_ids = {entry["id"] for entry in bindings}
        self.assertNotIn("dash_demo_notice", bound_ids)
        self.assertEqual(
            {entry["id"]: entry["read"]["channel"] for entry in bindings}["dash_mode"],
            "/devices/stdu_lab/controls/Source_Mode",
        )
        neutral_values = {
            "dash_mode": "UNKNOWN",
            "dash_controller_status": "UNKNOWN",
            "dash_clock": "NO DATA",
            "dash_run_id": "NO RUN",
            "dash_stage": "UNKNOWN",
            "dash_current_test": "NO DATA",
            "dash_run_status": "NOT_RUN",
            "dash_progress": "—",
            "dash_elapsed": "—",
            "dash_last_update": "NO DATA",
            "dash_passed": "—",
            "dash_failed": "—",
            "dash_ram_available": "— MiB",
            "dash_cpu_load": "—%",
            "dash_disk_free": "— GiB",
            "dash_swap_used": "— MiB",
            "dash_container_peak": "— MiB",
            "dash_last_event": "NO DATA",
            "dash_last_error": "NO DATA",
            "dash_event_time": "NO DATA",
            "dash_snapshot_age": "NO_DATA",
            "dash_collector_status": "UNKNOWN",
            "dash_limit_exceeded": "UNKNOWN",
            "dash_unknown_cleanup": "UNKNOWN",
            "dash_runtime_blocked": "UNKNOWN",
        }
        for name, elements in elements_by_file.items():
            values = {id_: "".join(elements[id_].itertext()) for id_ in elements}
            for id_, expected in neutral_values.items():
                self.assertEqual(values[id_], expected, f"non-neutral cold-start value {id_} in {name}")
            self.assertEqual(values["dash_demo_notice"], "DEMO · SYNTHETIC")
            self.assertEqual(values["dash_snapshot_age"], "NO_DATA")
            self.assertIn("OFFLINE = retained / last known", text_by_file[name])
            for code in STAGE_CODES:
                self.assertEqual(values[f"dash_stage_{code}_status"], "NOT_RUN")


if __name__ == "__main__":
    unittest.main()
