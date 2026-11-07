"""Offline guards and an opt-in disposable PostgreSQL integration test."""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import e2_cases as cases
import runtime_e2 as runner
from preflight import Blocked

TEST_IMAGE = "docker.io/library/postgres@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af"


class E2Guards(unittest.TestCase):
    def test_gate_before_any_provisioning(self):
        with (
            patch.object(sys, "argv", ["runtime_e2.py"]),
            patch.object(runner, "collect") as collect,
            self.assertRaisesRegex(Blocked, "OWNER_E2_RUNTIME_APPROVAL_REQUIRED"),
        ):
            runner.main()
        collect.assert_not_called()

    def test_payload_validation_precedes_clients(self):
        with self.assertRaisesRegex(Blocked, "E2_SYNTHETIC_PAYLOAD"):
            cases.run_cases(
                lambda _: self.fail("client created"), 0, digest="untrusted'"
            )

    def test_barrier_failure_is_bounded(self):
        observer = SimpleNamespace(scalar=lambda _: "f")
        with self.assertRaisesRegex(RuntimeError, "E2_BARRIER_TIMEOUT"):
            cases.wait_for(observer, "synthetic", time.monotonic() + 0.1)

    def test_already_buffered_reply_cannot_bypass_query_deadline(self):
        client = object.__new__(cases.Session)
        client.pending, client.buffer = "e2_marker", b"e2_marker\n"
        client.sent_at, client.deadline = 0, 100
        with (
            patch.object(cases.time, "monotonic", return_value=4),
            self.assertRaisesRegex(Blocked, "E2_LATE_QUERY"),
        ):
            client.receive()

    @unittest.skipUnless(
        sys.platform == "linux" and os.geteuid() == 0, "Linux root file metadata"
    )
    def test_retained_evidence_rejects_hash_permissions_symlink_and_fifo(self):
        for fault in ("hash", "mode", "symlink", "fifo", "valid"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                run = root / "a"
                run.mkdir(mode=0o700)
                file = run / "evidence.json"
                raw = b'{"synthetic":true}'
                file.write_bytes(raw)
                file.chmod(0o600)
                expected = hashlib.sha256(raw).hexdigest()
                if fault == "hash":
                    expected = "0" * 64
                elif fault == "mode":
                    file.chmod(0o644)
                elif fault in {"symlink", "fifo"}:
                    file.unlink()
                    if fault == "fifo":
                        os.mkfifo(file, mode=0o600)
                    else:
                        other = root / "other"
                        other.write_bytes(raw)
                        file.symlink_to(other)
                with (
                    patch.object(runner, "ROOT", root),
                    patch.object(runner, "RETAINED", {"a": expected}),
                ):
                    if fault == "valid":
                        runner.retained_evidence()
                    else:
                        with self.assertRaises((Blocked, OSError)):
                            runner.retained_evidence()

    @unittest.skipUnless(sys.platform == "linux", "Linux pipe selectors")
    def test_session_timeout_and_eof_close_exact_children(self):
        for script in ("import time; time.sleep(5)", "pass"):
            client = cases.Session(
                [sys.executable, "-I", "-B", "-c", script], time.monotonic() + 0.1
            )
            try:
                with self.assertRaises((Blocked, BrokenPipeError)):
                    client.query("SELECT synthetic;")
            finally:
                client.close()
            self.assertIsNotNone(client.process.poll())


@unittest.skipUnless(
    os.environ.get("WB_E2_REAL_PG") == "1", "explicit disposable PostgreSQL test"
)
class E2Postgres(unittest.TestCase):
    def test_six_cases_on_owned_networkless_postgres(self):
        docker = ["docker", "--host", "unix:///var/run/docker.sock"]
        run_id = uuid.uuid4().hex
        name = "wb-lab-01-e2-unit-" + run_id
        label = "stdu.wb-lab-01.run=" + run_id
        cid = None
        create_requested = False

        def cli(*args):
            return subprocess.check_output(
                docker + list(args), timeout=5, text=True
            ).strip()

        def inventory():
            return {
                kind: set(cli(kind, "ls", *flags).splitlines())
                for kind, flags in (
                    ("container", ("-aq", "--no-trunc")),
                    ("volume", ("-q",)),
                    ("network", ("-q", "--no-trunc")),
                )
            }

        before = inventory()
        try:
            [image] = json.loads(cli("image", "inspect", TEST_IMAGE))
            self.assertEqual(set(image["Config"]["Volumes"]), {"/var/lib/postgresql"})
            self.assertEqual((image["Os"], image["Architecture"]), ("linux", "amd64"))
            create_requested = True
            cid = cli(
                "container",
                "create",
                "--pull=never",
                "--name",
                name,
                "--label",
                label,
                "--network=none",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "--user=999:999",
                "--memory=192m",
                "--memory-swap=192m",
                "--cpus=0.5",
                "--pids-limit=32",
                "--log-driver=none",
                "--shm-size=16m",
                "--tmpfs",
                "/var/lib/postgresql:rw,size=128m,uid=999,gid=999,mode=700,nosuid,nodev,noexec",
                "--tmpfs",
                "/var/run/postgresql:rw,size=2m,mode=1777,nosuid,nodev,noexec",
                "--tmpfs",
                "/tmp:rw,size=8m,mode=1777,nosuid,nodev,noexec",
                "--entrypoint",
                "/bin/sh",
                image["Id"],
                "-ec",
                "initdb -D /var/lib/postgresql/data -U wb_bootstrap --locale=C --encoding=UTF8 "
                "--auth-local=trust --auth-host=reject >/dev/null && "
                "exec postgres -D /var/lib/postgresql/data -c listen_addresses= "
                "-c unix_socket_directories=/var/run/postgresql -c max_connections=6 -c shared_buffers=24MB",
            )
            [item] = json.loads(cli("container", "inspect", cid))
            self.assertEqual(item["Name"], "/" + name)
            self.assertEqual(item["Config"]["Labels"]["stdu.wb-lab-01.run"], run_id)
            self.assertFalse([m for m in item["Mounts"] if m["Type"] == "volume"])
            cli("container", "start", cid)
            ready_at = time.monotonic() + 20
            while True:
                p = subprocess.run(
                    docker
                    + [
                        "container",
                        "exec",
                        cid,
                        "pg_isready",
                        "-q",
                        "-h",
                        "/var/run/postgresql",
                        "-U",
                        "wb_bootstrap",
                    ],
                    timeout=3,
                    check=False,
                )
                if p.returncode == 0:
                    break
                self.assertIn(p.returncode, (1, 2))
                self.assertLess(time.monotonic(), ready_at)
                time.sleep(0.1)
            argv = docker + [
                "container",
                "exec",
                "-i",
                cid,
                "psql",
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-h",
                "/var/run/postgresql",
                "-U",
                "wb_bootstrap",
                "-d",
                "postgres",
            ]
            result = cases.run_cases(
                lambda end: cases.Session(argv, end), time.monotonic() + 30
            )
            self.assertEqual(len(result["trials"]), 6)
            self.assertEqual(result["reference_count"], 4)
            print("E2_SQL_ACCEPTANCE " + json.dumps(result))
        finally:
            if create_requested:
                item = runner.pg.base.inspect(
                    time.monotonic() + 5, "container", cid or name
                )
                if item is None:
                    self.assertIsNotNone(
                        cid, "test container create outcome unconfirmed"
                    )
                else:
                    self.assertEqual(item["Name"], "/" + name)
                    self.assertEqual(
                        item["Config"]["Labels"]["stdu.wb-lab-01.run"], run_id
                    )
                    self.assertEqual(item["Id"], cid or item["Id"])
                    cid = item["Id"]
                    cli("container", "rm", "--force", cid)
                    self.assertIsNone(
                        runner.pg.base.inspect(time.monotonic() + 5, "container", cid)
                    )
            after = inventory()
            for kind in before:
                self.assertTrue(
                    before[kind] <= after[kind], "foreign inventory changed"
                )


if __name__ == "__main__":
    unittest.main()
