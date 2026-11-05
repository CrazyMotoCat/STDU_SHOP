"""Offline tests for Compose normalization and read-only resource gates."""

import copy
import json
import os
import subprocess
import unittest
from pathlib import Path

from check_config import validate
from preflight import GIB, MIB, Blocked, thresholds, verify_runtime

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
        self.assertEqual(validate(self.config, RUN_ID)["container_memory_mib"], 256)

    def test_rejects_unowned_mount_and_network(self):
        for section, key in (("volumes", "media"), ("networks", "lab")):
            with self.subTest(section=section):
                config = copy.deepcopy(self.config)
                config[section][key]["external"] = True
                with self.assertRaises(Blocked):
                    validate(config, RUN_ID)

    def test_rejects_swap_network_and_ports(self):
        for key, value in (
            ("memswap_limit", 0),
            ("network_mode", "host"),
            ("ports", [3001]),
        ):
            with self.subTest(key=key):
                config = copy.deepcopy(self.config)
                config["services"]["controller"][key] = value
                with self.assertRaises(Blocked):
                    validate(config, RUN_ID)

    def test_rejects_any_runnable_decoder_service(self):
        for role in ("worker", "verifier"):
            config = copy.deepcopy(self.config)
            config["services"][role] = {"profiles": ["decode"]}
            with self.assertRaisesRegex(Blocked, "SERVICE_SET"):
                validate(config, RUN_ID)

    def test_tmpfs_uses_two_complete_hardened_entries(self):
        mounts = self.config["services"]["postgres"]["tmpfs"]
        self.assertEqual(len(mounts), 2)
        for invalid in (
            ["/tmp:size=8m", "mode=1777", "nosuid", "nodev", "noexec", mounts[1]],
            [mounts[0].replace(",noexec", ""), mounts[1]],
            [mounts[0], mounts[1].replace("size=2m", "size=3m")],
            [mounts[0], *mounts],
        ):
            with self.subTest(invalid=invalid):
                config = copy.deepcopy(self.config)
                config["services"]["postgres"]["tmpfs"] = invalid
                with self.assertRaisesRegex(Blocked, "TMPFS"):
                    validate(config, RUN_ID)

    def test_runtime_requires_owner_identity_versions_and_resource_limit_evidence(self):
        info = {
            "ID": "expected",
            "OSType": "linux",
            "Architecture": "aarch64",
            "ServerVersion": "29.9.2",
            "CgroupVersion": "2",
            "MemoryLimit": True,
            "SwapLimit": True,
            "CpuCfsQuota": True,
            "PidsLimit": True,
        }
        controllers = ["cpu", "memory", "pids"]
        verify_runtime(info, "v5.6.1", controllers, "expected")
        for field, value in (
            ("ID", "different"),
            ("ServerVersion", "29.8.0"),
            ("SwapLimit", False),
            ("PidsLimit", None),
            ("CgroupVersion", "1"),
        ):
            with self.subTest(field=field), self.assertRaises(Blocked):
                verify_runtime({**info, field: value}, "5.6.1", controllers, "expected")
        with self.assertRaisesRegex(Blocked, "COMPOSE_VERSION"):
            verify_runtime(info, "5.5.1", controllers, "expected")
        with self.assertRaisesRegex(Blocked, "CGROUP_CONTROLLERS"):
            verify_runtime(info, "5.6.1", ["cpu", "memory"], "expected")

    def test_watermarks(self):
        thresholds(768 * MIB, 4 * GIB)
        for ram, disk in ((768 * MIB - 1, 4 * GIB), (768 * MIB, 4 * GIB - 1)):
            with self.subTest(ram=ram, disk=disk), self.assertRaises(Blocked):
                thresholds(ram, disk)
