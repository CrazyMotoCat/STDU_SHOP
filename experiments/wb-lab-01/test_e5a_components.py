"""Offline fault injection for evidence, counters and commit reconciliation."""

import hashlib
import os
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from e5a_evidence import publish
from e5a_observation import counters, io_totals
from e5a_sql import insert_and_verify
from preflight import Blocked


class CounterTests(unittest.TestCase):
    def test_io_totals(self):
        self.assertEqual(
            io_totals(
                "179:2 rbytes=11 wbytes=5 rios=1 wios=2\n7:1 rbytes=3 wbytes=27 rios=4 wios=8"
            ),
            {"rbytes": 14, "wbytes": 32, "rios": 5, "wios": 10},
        )

    def test_malformed_or_ambiguous_counters_fail_closed(self):
        for value in ("oom 0\noom 1", "oom -1"):
            with self.subTest(value=value), self.assertRaises(Blocked):
                counters(value)


class CommitTests(unittest.TestCase):
    def test_timeout_after_commit_reconciles_without_repeat(self):
        calls = []

        def execute(sql):
            calls.append(sql)
            if sql.startswith("BEGIN;"):
                raise subprocess.TimeoutExpired("synthetic", 1)
            return ["e5a-1"]

        self.assertEqual(
            insert_and_verify(execute, 1)["outcome"], "COMMITTED_RECONCILED"
        )
        self.assertEqual(sum("INSERT" in sql for sql in calls), 1)

    def test_missing_commit_cannot_be_assumed(self):
        def execute(sql):
            return ["e5a-1"] if sql.startswith("BEGIN;") else []

        with self.assertRaisesRegex(Blocked, "E5A_COMMIT_OUTCOME_UNCONFIRMED"):
            insert_and_verify(execute, 1, discard_ack=True)


@unittest.skipUnless(hasattr(os, "O_DIRECTORY"), "Linux file descriptor semantics")
class EvidenceTests(unittest.TestCase):
    def test_exclusive_publication_and_hash(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                digest = publish(fd, {"samples": {}, "status": "E5A_BLOCKED"})
                record = directory / "evidence.json"
                self.assertEqual(
                    hashlib.sha256(record.read_bytes()).hexdigest(), digest
                )
                self.assertEqual(record.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(FileExistsError):
                    publish(fd, {"samples": {}, "status": "CHANGED"})
                self.assertEqual(
                    hashlib.sha256(record.read_bytes()).hexdigest(), digest
                )
                self.assertEqual(list(directory.iterdir()), [record])
            finally:
                os.close(fd)
