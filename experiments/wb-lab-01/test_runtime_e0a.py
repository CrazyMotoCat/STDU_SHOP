"""Offline E0a lifecycle tests. No Docker daemon or WB access."""

import unittest
from unittest.mock import patch

from runtime_e0a import (
    LABEL,
    LIMITS,
    Blocked,
    cleanup,
    owned_volume,
    validate_probe,
    watchdog,
)

CID = "a" * 64
NAME = "wb-lab-01-e0a-test"
RUN = "b" * 32


def volume(label=RUN):
    return {
        "Name": NAME,
        "Labels": {LABEL: label},
        "Driver": "local",
        "Scope": "local",
        "Options": {},
        "CreatedAt": "recorded",
        "Mountpoint": "/test/owned",
    }


def container(label=RUN):
    return {
        "Id": CID,
        "Name": "/" + NAME,
        "Config": {"Labels": {LABEL: label}},
        "State": {"Running": True},
    }


def ledger():
    return {
        "name": NAME,
        "run_id": RUN,
        "container_id": CID,
        "container_create_requested": True,
        "volume_create_requested": True,
        "volume": {"CreatedAt": "recorded", "Mountpoint": "/test/owned"},
    }


class E0aTests(unittest.TestCase):
    def test_observed_cgroup_and_network(self):
        observed = {
            "limits": LIMITS,
            "interfaces": ["lo"],
            "device": "179:2",
            "mount_read_only": True,
            "uid": 65532,
        }
        validate_probe(observed, "179:2")
        for change in (
            {"limits": {**LIMITS, "memory.swap.max": "max"}},
            {"interfaces": ["eth0", "lo"]},
            {"device": "8:1"},
            {"mount_read_only": False},
        ):
            with self.subTest(change=change), self.assertRaises(Blocked):
                validate_probe({**observed, **change}, "179:2")

    def test_cleanup_confirms_absence_in_order(self):
        with (
            patch(
                "runtime_e0a.inspect", side_effect=[container(), None, volume(), None]
            ) as inspect,
            patch("runtime_e0a.checked", return_value="") as command,
        ):
            cleanup(12, ledger())
        self.assertEqual(
            [c.args[1:] for c in command.call_args_list],
            [
                ("container", "rm", "--force", CID),
                ("container", "ls", "-aq", "--filter", "volume=" + NAME),
                ("volume", "rm", NAME),
            ],
        )
        self.assertEqual(inspect.call_args.args, (12, "volume", NAME))

    def test_foreign_container_and_replaced_volume_are_preserved(self):
        for observations in (
            [container("foreign")],
            [None, {**volume(), "CreatedAt": "replaced"}],
        ):
            with (
                self.subTest(observations=observations),
                patch("runtime_e0a.inspect", side_effect=observations),
                patch("runtime_e0a.checked") as command,
                self.assertRaisesRegex(Blocked, "OWNERSHIP|IDENTITY_CHANGED"),
            ):
                cleanup(12, ledger())
            command.assert_not_called()

    def test_volume_requires_label(self):
        with self.assertRaisesRegex(Blocked, "VOLUME_OWNERSHIP"):
            owned_volume(volume("foreign"), NAME, RUN)

    def test_still_attached_volume_is_preserved(self):
        with (
            patch("runtime_e0a.inspect", side_effect=[None, volume()]),
            patch("runtime_e0a.checked", return_value="foreign-container") as command,
            self.assertRaisesRegex(Blocked, "VOLUME_STILL_ATTACHED"),
        ):
            cleanup(12, ledger())
        self.assertEqual(command.call_count, 1)

    def test_create_unknown_without_id_is_not_clean(self):
        item = ledger()
        del item["container_id"]
        with (
            patch("runtime_e0a.inspect", return_value=None) as inspect,
            patch("runtime_e0a.checked") as command,
            self.assertRaisesRegex(Blocked, "CREATE_UNCERTAIN"),
        ):
            cleanup(12, item)
        inspect.assert_called_once_with(12, "container", NAME)
        command.assert_not_called()

    def test_unconfirmed_stop_preserves_volume(self):
        with (
            patch("runtime_e0a.inspect", side_effect=[container(), container()]),
            patch("runtime_e0a.checked") as command,
            self.assertRaisesRegex(Blocked, "CONTAINER_REMAINS"),
        ):
            cleanup(12, ledger())
        command.assert_called_once_with(12, "container", "rm", "--force", CID)

    def test_watchdog_invalidates_created_or_running_id_on_low_ram(self):
        for running in (False, True):
            item = container()
            item["State"]["Running"] = running
            with (
                self.subTest(running=running),
                patch("runtime_e0a.time.monotonic", return_value=1),
                patch("runtime_e0a.mem_available", return_value=0),
                patch("runtime_e0a.shutil.disk_usage") as usage,
                patch("runtime_e0a.inspect", side_effect=[item, None]) as inspect,
                patch("runtime_e0a.checked") as command,
                patch("runtime_e0a.multiprocessing.Event") as events,
            ):
                stop, ready = events(), events()
                stop.is_set.return_value = False
                usage.return_value.free = 5 * 1024**3
                with self.assertRaises(SystemExit) as failure:
                    watchdog(30, NAME, RUN, CID, stop, ready)
                self.assertEqual(failure.exception.code, 1)
            command.assert_called_once_with(5, "container", "rm", "--force", CID)
            self.assertEqual(inspect.call_args.args, (5, "container", CID))
