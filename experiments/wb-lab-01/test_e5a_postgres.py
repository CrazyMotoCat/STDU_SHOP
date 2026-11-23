"""Offline Unix socket boundary and workload tests with no Docker operations."""

import os
import socket
import subprocess
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event
from unittest.mock import patch

from e5a_pg_identity import SOCKET_NAME, DatabaseIdentity, socket_directory
from e5a_sql import execute_psql, insert_and_verify, query, workload
from preflight import Blocked

RUN = "a" * 32


class WorkloadTests(unittest.TestCase):
    def test_psql_connection_loss_reconciles_read_only(self):
        import time

        identity = DatabaseIdentity(RUN, "b" * 64, 1, 2, 3)
        with patch(
            "e5a_sql.subprocess.run",
            side_effect=[
                subprocess.CompletedProcess("psql", 2, ""),
                subprocess.CompletedProcess("psql", 0, "e5a-1\n"),
            ],
        ) as mock:
            result = insert_and_verify(
                lambda sql: execute_psql(42, identity, sql, time.monotonic() + 3), 1
            )
        self.assertEqual(result["outcome"], "COMMITTED_RECONCILED")
        self.assertEqual(mock.call_count, 2)
        self.assertIn("INSERT", mock.call_args_list[0].kwargs["input"])
        self.assertIn("BEGIN READ ONLY", mock.call_args_list[1].kwargs["input"])
        self.assertNotIn("INSERT", mock.call_args_list[1].kwargs["input"])

    def test_three_writes_and_two_sessions(self):
        holder_ready = Event()
        contender_done = Event()
        values = {}
        writes = []

        def execute(sql):
            self.assertIn("/* attest */", sql)
            if sql.startswith("SET application_name"):
                holder_ready.set()
                self.assertTrue(contender_done.wait(1))
                return ["1", ""]
            if "DO $lock$" in sql:
                self.assertTrue(holder_ready.wait(1))
                contender_done.set()
                return ["1000100"]
            if sql.startswith("BEGIN;"):
                sequence = len(writes) + 1
                writes.append(sequence)
                values[sequence] = f"e5a-{sequence}"
                if sequence == 3:
                    raise subprocess.TimeoutExpired("fake psql", 1)
                return [values[sequence]]
            self.assertTrue(sql.startswith("BEGIN READ ONLY;"))
            return [values[len(writes)]]

        evidence = workload(execute, RUN)
        self.assertEqual(writes, [1, 2, 3])
        self.assertEqual(evidence["transactions"][2]["outcome"], "COMMITTED_RECONCILED")
        self.assertEqual(evidence["row_lock"]["duration_us"], 1000100)


@unittest.skipUnless(
    hasattr(os, "geteuid") and os.geteuid() == 0, "requires isolated UID 999 fixture"
)
class SocketTests(unittest.TestCase):
    def test_private_anchored_socket_and_invalid_alternatives(self):
        with TemporaryDirectory() as path:
            root = Path(path)
            directory = root / "pg-socket"
            directory.mkdir(mode=0o700)
            os.chown(directory, 999, 999)
            state = directory.stat()
            identity = DatabaseIdentity(RUN, "b" * 64, state.st_dev, state.st_ino, 1)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            endpoint = directory / SOCKET_NAME
            try:
                with (
                    self.assertRaisesRegex(Blocked, "E5A_PG_SOCKET_MISSING"),
                    socket_directory(fd, identity, RUN),
                ):
                    self.fail("missing socket accepted")
                with socket.socket(socket.AF_UNIX) as server:
                    server.bind(str(endpoint))
                    os.chmod(endpoint, 0o700)
                    os.chown(endpoint, 999, 999)
                    identity = replace(identity, endpoint_inode=endpoint.stat().st_ino)
                    with socket_directory(fd, identity, RUN) as socket_fd:
                        self.assertEqual(os.fstat(socket_fd).st_ino, state.st_ino)
                    with (
                        patch("e5a_sql.execute_psql") as execute,
                        self.assertRaisesRegex(
                            Blocked, "E5A_PG_CONNECTED_PEER_UNPROVEN"
                        ),
                    ):
                        query(fd, identity, RUN, "SELECT 1", 1)
                    execute.assert_not_called()
                    with (
                        self.assertRaisesRegex(Blocked, "E5A_PG_LEDGER_IDENTITY"),
                        socket_directory(fd, identity, "0" * 32),
                    ):
                        self.fail("wrong run accepted")
                    os.chmod(directory, 0o755)
                    with (
                        self.assertRaisesRegex(Blocked, "E5A_PG_SOCKET_DIRECTORY"),
                        socket_directory(fd, identity, RUN),
                    ):
                        self.fail("open directory accepted")
                    os.chmod(directory, 0o700)
                    endpoint.rename(directory / "different.sock")
                    endpoint.symlink_to("different.sock")
                    with (
                        self.assertRaisesRegex(Blocked, "E5A_PG_SOCKET_IDENTITY"),
                        socket_directory(fd, identity, RUN),
                    ):
                        self.fail("socket symlink accepted")
            finally:
                os.close(fd)
