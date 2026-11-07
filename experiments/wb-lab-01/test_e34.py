"""Offline failure, ownership, network and approval regressions. Never touches WB."""

import errno
import hashlib
import os
import socket
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import e3_cases
import e3_probe as files
import e4_probe as net
import lab_metrics
import runtime_e0b as pg
import runtime_e34 as runner
from preflight import Blocked


@unittest.skipUnless(sys.platform == "linux", "Linux dirfd/fork/sockets")
class RecoveryTests(unittest.TestCase):
    def test_seven_storage_faults_recover_idempotently_and_preserve_canary(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "objects"
            result = files.run(root)
            self.assertEqual([x["case"] for x in result["trials"]], list(files.CASES))
            self.assertEqual(
                [x["expected"] for x in result["trials"]],
                ["RECOVERED"] * 6 + ["REFUSED"],
            )
            state = e3_cases.file_state(root, expected_uid=os.getuid())
            self.assertEqual(
                state["foreign"]["sha256"], hashlib.sha256(files.FOREIGN).hexdigest()
            )
            self.assertEqual(
                state["foreign"]["identity"], list(result["foreign_identity"])
            )
            self.assertEqual((root / "final/object_7").read_bytes(), files.FOREIGN)
            self.assertEqual((root / "stage/object_1").stat().st_size, 16)

    def test_missing_promoted_object_stops_before_recovery(self):
        original = files.interrupt

        def lose_promoted(stage, final, key, fault):
            result = original(stage, final, key, fault)
            if fault == "kill_promoted":
                os.unlink(key, dir_fd=final)
            return result

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "objects"
            with (
                patch.object(files, "interrupt", side_effect=lose_promoted),
                self.assertRaises(FileNotFoundError),
            ):
                files.run(root)
            self.assertFalse((root / "final/object_3").exists())

    def test_exclusive_symlink_and_foreign_collision_never_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "stage"
            final = root / "final"
            stage.mkdir()
            final.mkdir()
            foreign = root / "foreign"
            foreign.write_bytes(files.FOREIGN)
            (stage / "object_1").symlink_to(foreign)
            sfd = os.open(stage, os.O_DIRECTORY)
            ffd = os.open(final, os.O_DIRECTORY)
            try:
                with self.assertRaises(FileExistsError):
                    files.attempt(sfd, ffd, "object_1", "io_write", lambda: None)
                (final / "object_2").symlink_to(foreign)
                with self.assertRaises(OSError):
                    files.recover(sfd, ffd, "object_2")
                self.assertEqual(foreign.read_bytes(), files.FOREIGN)
            finally:
                os.close(sfd)
                os.close(ffd)

    def test_unexpected_fsync_failure_is_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "objects"
            with (
                patch.object(
                    files.os, "fsync", side_effect=OSError(errno.EIO, "synthetic")
                ),
                self.assertRaises(OSError),
            ):
                files.run(root)
            self.assertFalse((root / "final/object_1").exists())

    def test_missing_interruption_barrier_reaps_only_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            stage = root / "stage"
            final = root / "final"
            stage.mkdir()
            final.mkdir()
            sfd = os.open(stage, os.O_DIRECTORY)
            ffd = os.open(final, os.O_DIRECTORY)
            original = files.os.kill
            signalled = []

            def kill(pid, sig):
                self.assertNotEqual(pid, os.getpid())
                self.assertGreater(pid, 0)
                signalled.append(pid)
                return original(pid, sig)

            try:
                with (
                    patch.object(
                        files.selectors.DefaultSelector, "select", return_value=[]
                    ),
                    patch.object(files.os, "kill", side_effect=kill),
                    self.assertRaisesRegex(RuntimeError, "CHILD_BARRIER_TIMEOUT"),
                ):
                    files.interrupt(sfd, ffd, "object_1", "kill_partial")
                self.assertEqual(len(set(signalled)), 1)
                with self.assertRaises(ChildProcessError):
                    os.waitpid(signalled[0], os.WNOHANG)
            finally:
                os.close(sfd)
                os.close(ffd)

    def test_unknown_file_blocks_validation_without_deleting_anything(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "objects"
            files.run(root)
            unknown = root / "final/unknown"
            unknown.write_bytes(b"preserve")
            with self.assertRaisesRegex(Blocked, "E3_UNKNOWN_OBJECT"):
                e3_cases.file_state(root, expected_uid=os.getuid())
            self.assertEqual(unknown.read_bytes(), b"preserve")

    @unittest.skipUnless(os.geteuid() == 0, "root metadata ownership test")
    def test_cleanup_tree_rejects_unknown_owner_symlink_and_file(self):
        for fault in ("file", "owner", "symlink", "valid"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                work = root / "e3-work"
                work.mkdir()
                os.chown(work, 65532, 65532)
                if fault == "file":
                    (root / "foreign").write_bytes(b"preserve")
                elif fault == "owner":
                    os.chown(work, 0, 0)
                elif fault == "symlink":
                    (work / "objects").symlink_to(root, target_is_directory=True)
                ledger = {"volumes": {"media": {"identity": {"Mountpoint": str(root)}}}}
                dev = root.stat().st_dev
                ledger["media_device"] = f"{os.major(dev)}:{os.minor(dev)}"
                if fault == "valid":
                    e3_cases.cleanup_tree(ledger)
                else:
                    with self.assertRaises((Blocked, OSError)):
                        e3_cases.cleanup_tree(ledger)
                self.assertTrue(work.exists())


@unittest.skipUnless(sys.platform == "linux", "Linux process positive controls")
class NetworkTests(unittest.TestCase):
    def test_positive_tcp_and_udp_observers_really_receive(self):
        for kind in (socket.SOCK_STREAM, socket.SOCK_DGRAM):
            self.assertEqual(
                net.positive(kind), {"observed": True, "scope": "namespace_loopback"}
            )

    def test_no_negative_probe_precedes_topology_confirmation(self):
        with (
            patch.object(net, "namespace", side_effect=RuntimeError("IPV4_ROUTE")),
            patch.object(net, "positive") as positive,
            patch.object(net, "negative") as negative,
            self.assertRaisesRegex(RuntimeError, "IPV4_ROUTE"),
        ):
            net.run()
        positive.assert_not_called()
        negative.assert_not_called()

    def test_timeout_refusal_and_successful_datagram_do_not_prove_no_egress(self):
        for outcome in (TimeoutError(), OSError(errno.ECONNREFUSED, "refused"), None):
            sock = unittest.mock.MagicMock()
            sock.__enter__.return_value = sock
            sock.sendto.side_effect = outcome
            with (
                patch.object(net.socket, "socket", return_value=sock),
                self.assertRaises(RuntimeError),
            ):
                net.negative(socket.AF_INET, socket.SOCK_DGRAM, "192.0.2.1", 9)
        with patch.object(
            net.socket, "socket", side_effect=OSError(errno.ENETUNREACH, "unreachable")
        ):
            self.assertEqual(
                net.negative(socket.AF_INET, socket.SOCK_STREAM, "192.0.2.1", 9),
                {"errno": errno.ENETUNREACH, "sent": False},
            )

    def test_unexpected_mount_or_route_fails_closed(self):
        cases = (
            ("Interface\neth0 route\n", "", []),
            ("Interface\n", "001 eth0\n", []),
            ("Interface\n", "", ["1 2 3 / /secret rw - ext4 x rw"]),
        )
        for v4, v6, mounts in cases:
            content = {
                "/proc/net/route": v4,
                "/proc/net/ipv6_route": v6,
                "/proc/self/mountinfo": "\n".join(mounts),
            }
            with (
                patch.object(net.os, "listdir", return_value=["lo"]),
                patch.object(
                    net.Path,
                    "read_text",
                    lambda path, content=content: content[str(path)],
                ),
                self.assertRaises(RuntimeError),
            ):
                net.namespace()


class GateTests(unittest.TestCase):
    def test_gate_precedes_any_resource_or_host_access(self):
        with (
            patch.object(sys, "argv", ["runtime_e34.py"]),
            patch.object(runner, "collect") as collect,
            patch.object(pg, "run") as run,
            self.assertRaisesRegex(Blocked, "OWNER_E3_E4A_RUNTIME_APPROVAL_REQUIRED"),
        ):
            runner.main()
        collect.assert_not_called()
        run.assert_not_called()

    def test_child_cleanup_failure_prevents_pg_and_volume_cleanup(self):
        ledger = {"auxiliary_containers": [{"name": "owned-child"}]}
        with (
            patch.object(
                pg.base, "cleanup", side_effect=Blocked("OWNERSHIP")
            ) as cleanup,
            self.assertRaisesRegex(Blocked, "OWNERSHIP"),
        ):
            pg.cleanup(time.monotonic() + 0.1, ledger)
        cleanup.assert_called_once_with(unittest.mock.ANY, {"name": "owned-child"})

    def test_absent_metrics_are_explicit(self):
        with patch.object(lab_metrics.Path, "open", side_effect=FileNotFoundError):
            result = lab_metrics.read_metrics()
        self.assertEqual(
            [result[k] for k in ("memory.peak", "cpu.stat", "io.stat")],
            ["NOT_AVAILABLE"] * 3,
        )
