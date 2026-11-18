"""Offline archival checks; no WB or Docker calls."""

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import archive_e0a_pass as archive


class AcceptedArchiveTests(unittest.TestCase):
    def test_approval_required_before_io(self):
        with (
            patch.object(sys, "argv", ["archive"]),
            patch.object(archive, "private_directory") as check,
            self.assertRaises(RuntimeError),
        ):
            archive.archive()
        check.assert_not_called()

    @unittest.skipUnless(
        sys.platform == "linux", "Linux fd/permissions semantics in CI"
    )
    def test_exact_evidence_preserved_and_bad_hash_or_sgid_refused(self):
        for invalid in (None, "hash", "sgid"):
            with (
                self.subTest(invalid=invalid),
                tempfile.TemporaryDirectory() as directory,
            ):
                root, dest = Path(directory) / "lab", Path(directory) / "archive"
                root.mkdir(mode=0o700)
                dest.mkdir(mode=0o700)
                source = root / archive.RUN
                source.mkdir(mode=0o700)
                data = json.dumps(
                    {
                        "status": "E0A_RUNTIME_PASS",
                        "cleanup": "CONFIRMED",
                        "foreign_inventory": "PRESERVED",
                        "ledger": {
                            "run_id": archive.RUN,
                            "container_id": archive.CONTAINER,
                            "name": "wb-lab-01-e0a-" + archive.RUN,
                        },
                    }
                ).encode()
                (source / "evidence.json").write_bytes(data)
                if invalid == "sgid":
                    os.chmod(dest, 0o2700)
                with (
                    patch.object(archive, "ROOT", root),
                    patch.object(archive, "ARCHIVE", dest),
                    patch.object(sys, "argv", ["archive", archive.APPROVAL]),
                    patch.object(
                        archive,
                        "SHA256",
                        "invalid"
                        if invalid == "hash"
                        else hashlib.sha256(data).hexdigest(),
                    ),
                    patch.object(archive, "confirm_absence") as absent,
                    patch.object(archive, "authorize"),
                ):
                    if invalid:
                        with self.assertRaises(RuntimeError):
                            archive.archive()
                        self.assertEqual((source / "evidence.json").read_bytes(), data)
                    else:
                        result = archive.archive()
                        self.assertEqual(result["status"], "E0A_EVIDENCE_ARCHIVED")
                        absent.assert_called_once()
                        self.assertEqual(
                            (dest / archive.RUN / "evidence.json").read_bytes(), data
                        )
                        self.assertEqual(list(root.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
