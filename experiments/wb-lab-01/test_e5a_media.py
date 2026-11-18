"""Fail-closed configuration attestation for the working media controller."""

import copy
import unittest

from e5a_engine import CONFIG, LABEL, Engine, Intent
from e5a_media import PROBE, MediaController
from preflight import Blocked


class MediaAttestationTests(unittest.TestCase):
    def test_exact_profile_and_privilege_or_mount_substitution(self):
        intent = Intent("a" * 32, "daemon", "sha256:" + "b" * 64)
        media = MediaController(Engine(lambda *args: None), intent)
        cid = "c" * 64
        volume = {"CreatedAt": "synthetic", "Mountpoint": "/synthetic-owned-volume"}
        item = {
            "Id": cid,
            "Name": "/" + intent.name,
            "Image": intent.image,
            "Config": {
                "Image": intent.image,
                "Labels": {LABEL: intent.run},
                "Entrypoint": ["/usr/local/bin/python"],
                "Cmd": ["-I", "-S", "-c", PROBE],
                "User": "65534:65534",
                "NetworkDisabled": True,
            },
            "HostConfig": {**CONFIG, "Privileged": False},
            "NetworkSettings": {"Ports": {}},
            "Mounts": [
                {
                    "Type": "volume",
                    "Name": media.volume,
                    "Source": volume["Mountpoint"],
                    "Destination": "/media",
                    "RW": True,
                }
            ],
        }
        media.verify(item, cid, volume)
        for key, value in {
            "CapAdd": ["SYS_ADMIN"],
            "PidMode": "host",
            "UTSMode": "host",
            "IpcMode": "host",
            "CgroupnsMode": "host",
            "SecurityOpt": [],
            "CapDrop": [],
            "NetworkMode": "bridge",
        }.items():
            with self.subTest(field=key):
                bad = copy.deepcopy(item)
                bad["HostConfig"][key] = value
                with self.assertRaises(Blocked):
                    media.verify(bad, cid, volume)
        bad = copy.deepcopy(item)
        bad["Mounts"].append({"Type": "bind", "Destination": "/socket"})
        with self.assertRaises(Blocked):
            media.verify(bad, cid, volume)

    def test_empty_stop_304_is_a_bodyless_engine_response(self):
        engine = Engine(lambda *args: (304, b""))
        import time

        self.assertIsNone(
            engine.request("POST", "/unused", time.monotonic() + 1, statuses=(304,))
        )
