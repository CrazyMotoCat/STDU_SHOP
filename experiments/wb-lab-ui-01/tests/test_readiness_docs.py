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
        e0a_link = "https://github.com/CrazyMotoCat/STDU_SHOP/pull/54#issuecomment-6702279053"
        e0b_link = "https://github.com/CrazyMotoCat/STDU_SHOP/blob/2f0246c73d25045cf572a350884a441f41383666/experiments/wb-lab-01/RUNTIME-E0B.md"

        for document in (readme, contract):
            self.assertIn("E0A_RUNTIME_PASS", document)
            self.assertIn(e0a_link, document)
            self.assertIn("E0B_BLOCKED", document)
            self.assertIn("E0B_DOCKER_COMMAND_FAILED", document)
            self.assertIn("742071b6115e4a00a8b65cc7151f8c39", document)
            self.assertIn("dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28", document)
            self.assertIn("CONFIRMED", document)
            self.assertIn(e0b_link, document)
            self.assertIn("E1–E5", document)
            self.assertIn("VDS_equivalence", document)
            self.assertNotIn("E0a Runtime BLOCKED", document)

        self.assertEqual(DEFAULTS["Stage_E0a_Status"], "NOT_RUN")
        self.assertEqual(DEFAULTS["Stage_E0b_Status"], "NOT_RUN")
        self.assertEqual(DEFAULTS["Status"], "NOT_RUN")
        self.assertEqual(DEFAULTS["Source_Mode"], "UNKNOWN")
        self.assertEqual(DEFAULTS["Telemetry_State"], "NO_DATA")

    def test_homeui_plan_has_backup_compatibility_and_targeted_rollback(self) -> None:
        bindings = (ROOT / "bindings.md").read_text(encoding="utf-8")
        for requirement in (
            "2.267.7",
            "export every existing dashboard/panel artifact",
            "SHA-256",
            "JSON.stringify",
            "JSON.parse",
            "JSON syntax and editor parse/serialize compatibility: PASS",
            "stdu-lab-desktop",
            "stdu-lab-mobile",
            "Addressed rollback",
            "exact new panel ID",
            "both panels passed cold start and DEMO checks",
            "OWNER_HOMEUI_IMPORT_APPROVED",
            "trailing retained `$SYS/broker/version` replay marker",
            "disable fit-to-page for mobile",
            "only `read` and fixed `style` actions",
            "pre-existing panel appears changed",
            "leave it untouched",
            "desktop panel as the first import canary",
            "stop before adding mobile",
        ):
            self.assertIn(requirement.casefold(), bindings.casefold())
        self.assertIn("Do not import if any check fails", bindings)
        self.assertIn("do not clear or rewrite", bindings.casefold())
        self.assertIn("no direct edit", bindings.casefold())

    def test_checkpoint_has_current_lab_status_and_owner_gate(self) -> None:
        checkpoint = (ROOT.parents[1] / ".agent" / "tasks" / "WB-LAB-UI-01" / "state.md").read_text(encoding="utf-8")
        for requirement in (
            "E0A_RUNTIME_PASS / OWNER ACCEPTED",
            "E0B_BLOCKED / E0B_DOCKER_COMMAND_FAILED",
            "742071b6115e4a00a8b65cc7151f8c39",
            "dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28",
            "cleanup `CONFIRMED`",
            "E1–E5",
            "VDS_equivalence: NOT_PROVEN",
            "READY_FOR_OWNER_HOMEUI_IMPORT_APPROVAL",
            "OWNER_HOMEUI_IMPORT_APPROVED",
        ):
            self.assertIn(requirement, checkpoint)

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
