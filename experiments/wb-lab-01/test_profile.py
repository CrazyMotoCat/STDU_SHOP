"""Offline tests for Compose normalization and read-only resource gates."""

import copy
import json
import os
import subprocess
import unittest
from pathlib import Path

from check_config import validate
from preflight import GIB, MIB, Blocked, thresholds

RUN_ID = "0123456789abcdef0123456789abcdef"


class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(Path(__file__).with_name("compose.yaml")),
                "--profile",
                "decode",
                "-p",
                "wb-lab-01-" + RUN_ID,
                "config",
                "--format",
                "json",
            ],
            env={
                **os.environ,
                "WB_RUN_ID": RUN_ID,
                "WB_PG_PASSWORD_FILE": f"/mnt/data/stdu-wb-lab-01/{RUN_ID}/pg_password",
            },
            capture_output=True,
            check=True,
            timeout=10,
        )
        cls.config = json.loads(result.stdout)

    def test_rendered_configuration(self):
        self.assertEqual(validate(self.config, RUN_ID)["container_memory_mib"], 512)

    def test_rejects_unowned_mount_and_network(self):
        for section, key in (("volumes", "media"), ("networks", "lab")):
            with self.subTest(section=section):
                config = copy.deepcopy(self.config)
                config[section][key]["external"] = True
                with self.assertRaises(Blocked):
                    validate(config, RUN_ID)

    def test_rejects_swap_network_ports_and_secrets(self):
        for key, value in (
            ("memswap_limit", 0),
            ("network_mode", "host"),
            ("ports", [3001]),
            ("environment", {"PGPASSWORD": "synthetic"}),
        ):
            with self.subTest(key=key):
                config = copy.deepcopy(self.config)
                config["services"]["worker"][key] = value
                with self.assertRaises(Blocked):
                    validate(config, RUN_ID)

    def test_watermarks(self):
        thresholds(768 * MIB, 4 * GIB)
        for ram, disk in ((768 * MIB - 1, 4 * GIB), (768 * MIB, 4 * GIB - 1)):
            with self.subTest(ram=ram, disk=disk), self.assertRaises(Blocked):
                thresholds(ram, disk)
