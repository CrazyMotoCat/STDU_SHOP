"""Offline filesystem and failure-order regressions for E1."""

import errno
import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import e1_probe as probe
import runtime_e1 as runner


@unittest.skipUnless(
    sys.platform == "linux", "Linux directory fd and hard-link semantics"
)
class E1Tests(unittest.TestCase):
    def test_three_trials_preserve_canary_and_publish_original_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trials = probe.run(root)
            dev = root.stat().st_dev
            runner.validate_result(
                {
                    "trials": trials,
                    "device": f"{os.major(dev)}:{os.minor(dev)}",
                    "uid": 65532,
                    "interfaces": ["lo"],
                    "limits": runner.LIMITS,
                },
                f"{os.major(dev)}:{os.minor(dev)}",
            )
            self.assertFalse((root / "stage/promotion").exists())
            self.assertEqual(
                (root / "final/promotion").stat().st_ino, trials[0]["identity"][1]
            )
            self.assertEqual((root / "final/promotion").read_bytes(), probe.PAYLOAD)
            for name in (
                "stage/exclusive_collision",
                "final/promotion_collision",
                "final/canary",
            ):
                self.assertEqual((root / name).read_bytes(), probe.CANARY)

    def test_faults_stop_before_unsafe_next_operation_and_preserve_foreign(self):
        for fault in ("write", "file_fsync", "stage_fsync", "final_fsync"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stage, final = root / "stage", root / "final"
                stage.mkdir()
                final.mkdir()
                foreign = final / "foreign"
                foreign.write_bytes(b"foreign")
                foreign_id = foreign.stat().st_ino
                sfd = os.open(stage, os.O_DIRECTORY)
                ffd = os.open(final, os.O_DIRECTORY)
                try:
                    real_sync = os.fsync

                    def sync(fd, sfd=sfd, ffd=ffd, fault=fault, real_sync=real_sync):
                        kind = (
                            "stage_fsync"
                            if fd == sfd
                            else "final_fsync"
                            if fd == ffd
                            else "file_fsync"
                        )
                        if kind == fault:
                            raise OSError(errno.EIO, fault)
                        real_sync(fd)

                    with (
                        patch.object(os, "fsync", side_effect=sync),
                        patch.object(
                            probe,
                            "write_all",
                            side_effect=OSError(errno.EIO, fault)
                            if fault == "write"
                            else probe.write_all,
                        ),
                        self.assertRaises(OSError),
                    ):
                        probe.trial(sfd, ffd, "promotion")
                finally:
                    os.close(ffd)
                    os.close(sfd)
                self.assertTrue((stage / "promotion").exists())
                self.assertEqual((final / "promotion").exists(), fault == "final_fsync")
                self.assertEqual(foreign.stat().st_ino, foreign_id)
                self.assertEqual(
                    hashlib.sha256(foreign.read_bytes()).digest(),
                    hashlib.sha256(b"foreign").digest(),
                )

    def test_unknown_volume_object_blocks_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            foreign = root / "unknown"
            foreign.write_bytes(b"foreign")
            identity = {"CreatedAt": "synthetic", "Mountpoint": str(root)}
            item = {
                **identity,
                "Name": "owned",
                "Labels": {runner.LABEL: "run"},
                "Driver": "local",
                "Scope": "local",
                "Options": {},
            }
            with (
                patch.object(runner, "inspect", return_value=item),
                self.assertRaisesRegex(runner.Blocked, "E1_UNKNOWN_DIRECTORY"),
            ):
                runner.verify_volume_contents(
                    30, {"name": "owned", "run_id": "run", "volume": identity}
                )
            self.assertEqual(foreign.read_bytes(), b"foreign")
