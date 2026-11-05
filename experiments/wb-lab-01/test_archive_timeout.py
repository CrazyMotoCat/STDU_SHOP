import subprocess
import unittest
from unittest.mock import patch

from archive_timeout import (
    DAEMON,
    EXPECTED_CONTAINER,
    RUN,
    confirm_absence,
    validate_saved,
)
from preflight import Blocked


class ArchiveTests(unittest.TestCase):
    def test_exact_successful_cleanup_evidence_required(self):
        saved = {
            "status": "BLOCKED",
            "reason": "TimeoutExpired",
            "cleanup": "CONFIRMED",
            "foreign_inventory": "PRESERVED",
            "ledger": {
                "run_id": RUN,
                "name": "wb-lab-01-e0a-" + RUN,
                "container_id": EXPECTED_CONTAINER,
                "container_create_requested": True,
                "volume_create_requested": True,
                "volume": {
                    "Mountpoint": "/mnt/data/docker/lib/volumes/wb-lab-01-e0a-"
                    + RUN
                    + "/_data"
                },
            },
        }
        validate_saved(saved)
        for field, value in (
            ("cleanup", "UNCONFIRMED"),
            ("reason", "LOCAL_IMAGE_ID"),
            ("foreign_inventory", "UNKNOWN"),
        ):
            with self.subTest(field=field), self.assertRaises(Blocked):
                validate_saved({**saved, field: value})

    def test_daemon_mismatch_blocks_absence_checks(self):
        with (
            patch("archive_timeout.engine_info", return_value={"ID": "different"}),
            patch("archive_timeout.inspect") as inspect,
            self.assertRaisesRegex(Blocked, "DAEMON_MISMATCH"),
        ):
            confirm_absence({"container_id": EXPECTED_CONTAINER, "name": RUN})
        inspect.assert_not_called()

    def test_remaining_resource_or_timeout_blocks_archival(self):
        for observed in ({}, subprocess.TimeoutExpired("synthetic", 3)):
            with (
                self.subTest(observed=observed),
                patch("archive_timeout.engine_info", return_value={"ID": DAEMON}),
                patch("archive_timeout.inspect", side_effect=[observed]),
                self.assertRaises((Blocked, subprocess.TimeoutExpired)),
            ):
                confirm_absence({"container_id": EXPECTED_CONTAINER, "name": RUN})

    def test_absence_must_be_confirmed_for_all_exact_resources(self):
        with (
            patch("archive_timeout.engine_info", return_value={"ID": DAEMON}),
            patch("archive_timeout.inspect", return_value=None) as inspect,
        ):
            confirm_absence({"container_id": EXPECTED_CONTAINER, "name": RUN})
        self.assertEqual(inspect.call_count, 3)
