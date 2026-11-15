"""Regression tests for same-FD attestation and the PG data watermark."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from e5a_libpq import Peer, exchange
from e5a_pg_identity import DatabaseIdentity
from e5a_pg_watermark import WATERMARK, measure
from preflight import Blocked


class LibpqTests(unittest.TestCase):
    def lib(self):
        lib = Mock()
        lib.PQconnectPoll.return_value = 3
        lib.PQstatus.return_value = 0
        lib.PQsocket.return_value = 17
        lib.PQsetnonblocking.return_value = 0
        lib.PQsendQuery.return_value = 1
        lib.PQflush.return_value = 0
        lib.PQisBusy.return_value = 0
        lib.PQgetResult.return_value = None
        return lib

    def run_exchange(self, lib, attest):
        import time

        return exchange(
            9,
            DatabaseIdentity("a" * 32, "b" * 64, 1, 2, 3),
            Peer(10, 25),
            "BEGIN; COMMIT;",
            time.monotonic() + 3,
            lib=lib,
            attest=attest,
        )

    def test_same_connection_and_fd_used_before_send(self):
        lib = self.lib()
        proof = Mock(return_value=(1, 91))
        self.assertEqual(self.run_exchange(lib, proof), [])
        self.assertEqual(proof.call_count, 3)
        lib.PQsendQuery.assert_called_once_with(
            lib.PQconnectStart.return_value, b"BEGIN; COMMIT;"
        )
        lib.PQfinish.assert_called_once_with(lib.PQconnectStart.return_value)

    def test_fd_replacement_or_wrong_peer_blocks_before_send(self):
        for fault in ("fd", "inode", "peer"):
            with self.subTest(fault=fault):
                lib = self.lib()
                proof = Mock(return_value=(1, 91))
                if fault == "fd":
                    lib.PQsocket.side_effect = [17, 18]
                elif fault == "inode":
                    proof.side_effect = [(1, 91), (1, 92)]
                else:
                    proof.side_effect = Blocked("E5A_PG_PEER_IDENTITY")
                with self.assertRaises(Blocked):
                    self.run_exchange(lib, proof)
                lib.PQsendQuery.assert_not_called()
                lib.PQfinish.assert_called_once()


@unittest.skipUnless(hasattr(os, "O_DIRECTORY"), "requires POSIX dir_fd")
class WatermarkTests(unittest.TestCase):
    def test_boundary_expiry_and_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try:
                meta = os.fstat(fd)
                identity = (meta.st_dev, meta.st_ino)
                data = Path(directory) / "postgres"
                with data.open("wb") as stream:
                    stream.truncate(WATERMARK - 1)
                    self.assertEqual(
                        measure(fd, identity, 1, clock=lambda: 0), WATERMARK - 1
                    )
                    stream.truncate(WATERMARK)
                    with self.assertRaisesRegex(Blocked, "E5A_PG_DATA_WATERMARK"):
                        measure(fd, identity, 1, clock=lambda: 0)
                    with self.assertRaisesRegex(Blocked, "E5A_PG_DATA_SAMPLE_STALE"):
                        measure(fd, identity, 1, clock=lambda: 1)
                data.unlink()
                data.symlink_to("outside")
                with self.assertRaisesRegex(Blocked, "E5A_PG_DATA_UNKNOWN_ENTRY"):
                    measure(fd, identity, 1, clock=lambda: 0)
            finally:
                os.close(fd)
