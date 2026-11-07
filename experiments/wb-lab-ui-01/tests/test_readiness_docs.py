from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from telemetry_bridge.contract import DEFAULTS  # noqa: E402


class ReadinessDocumentationTests(unittest.TestCase):
    def test_accepted_e0a_evidence_does_not_seed_dashboard_defaults(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        contract = (ROOT / "mqtt-contract.md").read_text(encoding="utf-8")
        evidence_link = "https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053"

        for document in (readme, contract):
            self.assertIn("E0A_RUNTIME_PASS", document)
            self.assertIn(evidence_link, document)
            self.assertIn("E0b–E5", document)
            self.assertIn("VDS_equivalence", document)
            self.assertNotIn("E0a Runtime BLOCKED", document)

        self.assertEqual(DEFAULTS["Stage_E0a_Status"], "NOT_RUN")
        self.assertEqual(DEFAULTS["Source_Mode"], "UNKNOWN")
        self.assertEqual(DEFAULTS["Telemetry_State"], "NO_DATA")

    def test_homeui_plan_has_backup_compatibility_and_targeted_rollback(self) -> None:
        bindings = (ROOT / "bindings.md").read_text(encoding="utf-8")
        for requirement in (
            "2.267.7",
            "export every existing SVG panel",
            "SHA-256",
            "JSON shape",
            "stdu-lab-desktop",
            "stdu-lab-mobile",
            "Addressed rollback",
            "exact new panel ID",
            "NOT_VERIFIED",
        ):
            self.assertIn(requirement.casefold(), bindings.casefold())
        self.assertIn("Do not import if any check fails", bindings)
        self.assertIn("do not clear or rewrite", bindings.casefold())
        self.assertIn("no direct edit", bindings.casefold())

    def test_demo_transport_plan_is_loopback_only_and_excludes_command_topics(self) -> None:
        plan = (ROOT / "DEMO-PLAN.md").read_text(encoding="utf-8")
        for requirement in (
            "127.0.0.1",
            "disposable broker",
            "Do not publish any MQTT message to WB",
            "Do not subscribe to `/devices/#`",
            "`/on`",
            "DEMO_TRANSPORT_ONLY",
            "does not affect that result",
        ):
            self.assertIn(requirement, plan)


if __name__ == "__main__":
    unittest.main()
