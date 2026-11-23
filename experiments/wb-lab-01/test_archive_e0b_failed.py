"""Exercise the exact-run archival transaction with temporary Linux directories."""

import hashlib
import json
import os
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import archive_e0b_failed as job


def fixture():
    return {
        "status": "BLOCKED",
        "reason": "E0B_DOCKER_COMMAND_FAILED",
        "cleanup": "CONFIRMED",
        "foreign_inventory": "PRESERVED",
        "ledger": {
            "run_id": job.RUN,
            "name": job.NAME,
            "container_id": job.CONTAINER,
            "container_create_requested": True,
            "image_id": job.IMAGE.split("@")[1],
            "volumes": {
                role: {
                    "name": name,
                    "requested": True,
                    "identity": {
                        "Mountpoint": f"{job.DOCKER_ROOT}/volumes/{name}/_data",
                        "CreatedAt": "2026-11-07T15:26:32+10:00",
                    },
                }
                for role, name in job.VOLUMES.items()
            },
        },
    }


class ArchiveGateTests(unittest.TestCase):
    def test_requires_owner_gate_before_io(self):
        with (
            patch.object(sys, "argv", ["archive"]),
            patch.object(job, "directory") as directory,
            self.assertRaisesRegex(job.Blocked, "OWNER_E0B_RUNTIME_APPROVAL_REQUIRED"),
        ):
            job.archive()
        directory.assert_not_called()


@unittest.skipUnless(sys.platform == "linux", "Linux fd, permissions and renameat2")
class ArchiveTests(unittest.TestCase):
    def setUp(self):
        stack = self.enterContext(ExitStack())
        parent = Path(stack.enter_context(tempfile.TemporaryDirectory())).resolve()
        self.root, self.dest = parent / "lab", parent / "archive"
        self.source, self.target = self.root / job.RUN, self.dest / job.RUN
        for directory in (self.root, self.dest, self.source):
            directory.mkdir(mode=0o700)
        self.file = self.source / job.FILE
        self.info = {"ID": job.DAEMON, "DockerRootDir": job.DOCKER_ROOT}
        self.fs = {
            "target": "/",
            "source": "/dev/mmcblk0p2",
            "fstype": "ext4",
            "maj:min": "179:2",
            "options": "rw,noatime",
        }
        for name, value in (
            ("ROOT", self.root),
            ("ARCHIVE", self.dest),
            ("authorize", lambda: None),
        ):
            stack.enter_context(patch.object(job, name, value))
        self.engine = stack.enter_context(
            patch.object(job, "engine_info", return_value=self.info)
        )
        self.inspect = stack.enter_context(
            patch.object(job, "inspect", return_value=None)
        )
        self.list_resources = stack.enter_context(
            patch.object(job, "checked", return_value="")
        )
        self.mount = stack.enter_context(
            patch.object(job, "mount", return_value=self.fs)
        )
        stack.enter_context(
            patch.dict(
                os.environ,
                {
                    key: ""
                    for key in (
                        "DOCKER_HOST",
                        "DOCKER_CONTEXT",
                        "DOCKER_TLS_VERIFY",
                    )
                },
            )
        )
        self.saved = fixture()
        self.write_evidence()

    def write_evidence(self):
        self.data = (json.dumps(self.saved, indent=2) + "\n").encode()
        self.file.write_bytes(self.data)
        self.file.chmod(0o600)

    def archive(self):
        with patch.object(job, "SHA256", hashlib.sha256(self.data).hexdigest()):
            return job.archive()

    def blocked(self, code):
        with self.assertRaisesRegex(job.Blocked, code):
            self.archive()
        self.assertEqual(self.file.read_bytes(), self.data)
        self.assertFalse(self.target.exists())

    def test_preserves_file_inode_hash_and_bytes_and_syncs_directories(self):
        inode = self.file.stat().st_ino
        with patch.object(job.os, "fsync", wraps=os.fsync) as sync:
            result = self.archive()
        self.assertEqual(result["status"], "E0B_FAILED_EVIDENCE_ARCHIVED")
        self.assertEqual(result["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertEqual((self.target / job.FILE).read_bytes(), self.data)
        self.assertEqual((self.target / job.FILE).stat().st_ino, inode)
        self.assertEqual(sync.call_count, 3)
        self.assertEqual(
            [call.args[1:] for call in self.inspect.call_args_list],
            [
                ("container", job.CONTAINER),
                ("container", job.NAME),
                ("volume", job.VOLUMES["pg"]),
                ("volume", job.VOLUMES["media"]),
            ],
        )

    def test_wrong_hash_or_state_preserves_source(self):
        with self.assertRaisesRegex(job.Blocked, "E0B_ARCHIVE_SHA256"):
            job.archive()
        self.assertEqual(self.file.read_bytes(), self.data)
        self.saved["status"] = "E0B_RUNTIME_PASS"
        self.write_evidence()
        self.blocked("E0B_ARCHIVE_EVIDENCE_STATE")
        self.engine.assert_not_called()

    def test_rejects_run_and_volume_ledger_substitution_even_with_matching_hash(self):
        self.saved["ledger"]["run_id"] = "foreign"
        self.write_evidence()
        self.blocked("E0B_ARCHIVE_LEDGER")
        self.saved = fixture()
        self.saved["ledger"]["volumes"]["media"]["identity"]["Mountpoint"] = "/foreign"
        self.write_evidence()
        self.blocked("E0B_ARCHIVE_VOLUME_LEDGER")

    def test_daemon_mismatch_and_foreign_resources_preserve_source(self):
        self.engine.return_value = {**self.info, "ID": "different"}
        self.blocked("E0B_ARCHIVE_DAEMON")
        self.inspect.assert_not_called()
        self.engine.return_value = self.info
        for index in range(4):
            with self.subTest(index=index):
                self.inspect.side_effect = [None] * index + [
                    {"Labels": {"owner": "other"}}
                ]
                self.blocked("E0B_ARCHIVE_RESOURCE_PRESENT")
        self.inspect.side_effect = None
        self.list_resources.return_value = "unknown-lab-resource"
        self.blocked("E0B_ARCHIVE_OTHER_LAB_RESOURCE")

    def test_extra_files_are_rejected_in_lab_root_and_run(self):
        for parent, code in (
            (self.root, "ROOT_CONTENTS"),
            (self.source, "RUN_CONTENTS"),
        ):
            with self.subTest(parent=parent):
                extra = parent / "extra"
                extra.write_bytes(b"untouched")
                self.blocked(f"E0B_ARCHIVE_{code}")
                self.assertEqual(extra.read_bytes(), b"untouched")
                extra.unlink()

    def test_symlink_owner_mode_and_wrong_filesystem_are_rejected(self):
        self.file.chmod(0o644)
        self.blocked("E0B_ARCHIVE_FILE_OWNER_MODE_TYPE")
        self.file.chmod(0o600)
        self.dest.chmod(0o755)
        self.blocked("E0B_ARCHIVE_DIRECTORY_OWNER_MODE")
        self.dest.chmod(0o700)
        with patch.object(job.os, "geteuid", return_value=os.geteuid() + 1):
            self.blocked("E0B_ARCHIVE_DIRECTORY_OWNER_MODE")
        external = self.source.parent.parent / "external"
        self.file.rename(external)
        self.file.symlink_to(external)
        with self.assertRaises(OSError):
            self.archive()
        self.assertEqual(external.read_bytes(), self.data)
        self.file.unlink()
        external.rename(self.file)
        self.mount.return_value = {**self.fs, "fstype": "tmpfs"}
        self.blocked("E0B_ARCHIVE_FILESYSTEM")

    def test_archive_collision_refuses_to_overwrite_even_after_precheck(self):
        self.target.mkdir()
        with self.assertRaisesRegex(job.Blocked, "E0B_ARCHIVE_COLLISION"):
            self.archive()
        self.assertEqual(self.file.read_bytes(), self.data)
        self.target.rmdir()
        real_rename = job.rename_exclusive

        def late_collision(*args):
            self.target.mkdir()
            real_rename(*args)

        with (
            patch.object(job, "rename_exclusive", side_effect=late_collision),
            self.assertRaises(FileExistsError),
        ):
            self.archive()
        self.assertEqual(self.file.read_bytes(), self.data)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_postcheck_failure_retains_original_at_destination(self):
        real_rename = job.rename_exclusive

        def unexpected_root_content(*args):
            real_rename(*args)
            (self.root / "unexpected").mkdir()

        with (
            patch.object(job, "rename_exclusive", side_effect=unexpected_root_content),
            self.assertRaisesRegex(job.Blocked, "E0B_ARCHIVE_POSTCHECK"),
        ):
            self.archive()
        self.assertEqual((self.target / job.FILE).read_bytes(), self.data)
        self.assertFalse(self.source.exists())


if __name__ == "__main__":
    unittest.main()
