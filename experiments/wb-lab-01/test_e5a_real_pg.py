"""Explicit local-only PostgreSQL integration, using extracted distro binaries."""

import ctypes
import json
import os
import signal
import subprocess
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path

from e5a_libpq import Peer
from e5a_pg_engine import PostgresIntent
from e5a_pg_identity import DatabaseIdentity
from e5a_sql import query, workload
from preflight import Blocked
from runtime_e5a import process_start


@unittest.skipUnless(
    os.environ.get("WB_E5A_REAL_PG") == "1"
    and hasattr(os, "geteuid")
    and os.geteuid() == 0,
    "opt-in disposable local PostgreSQL integration",
)
class RealPostgresTests(unittest.TestCase):
    def test_same_peer_bootstrap_lock_timeout_and_reconciled_commit(self):
        packages = Path(os.environ["WB_E5A_PG_PACKAGES"]).resolve(strict=True)
        binary = packages / "usr/lib/postgresql/18/bin"
        library = packages / "usr/lib/x86_64-linux-gnu"
        version = subprocess.run(
            [str(binary / "postgres"), "--version"],
            env={"LD_LIBRARY_PATH": str(library)},
            capture_output=True,
            check=True,
            timeout=3,
            text=True,
        ).stdout.strip()
        self.assertIn("18.", version)
        with tempfile.TemporaryDirectory(prefix="wb-e5a-sql-") as path:
            root = Path(path)
            os.chmod(root, 0o711)
            data = root / "data"
            data.mkdir(mode=0o700)
            os.chown(data, 999, 999)
            unix = root / "pg-socket"
            unix.mkdir(mode=0o700)
            os.chown(unix, 999, 999)
            (root / "passwd").write_text("wbtest:x:999:999:synthetic:/tmp:/bin/false\n")
            (root / "group").write_text("wbtest:x:999:\n")
            env = {
                "PATH": str(binary) + ":/usr/bin:/bin",
                "LD_LIBRARY_PATH": str(library),
                "LD_PRELOAD": str(library / "libnss_wrapper.so"),
                "NSS_WRAPPER_PASSWD": str(root / "passwd"),
                "NSS_WRAPPER_GROUP": str(root / "group"),
                "LANG": "C",
            }
            command = [
                "/usr/bin/setpriv",
                "--reuid=999",
                "--regid=999",
                "--clear-groups",
            ]
            subprocess.run(
                [
                    *command,
                    str(binary / "initdb"),
                    "-D",
                    str(data),
                    "-U",
                    "wb_bootstrap",
                    "--locale=C",
                    "--auth-local=trust",
                    "--auth-host=reject",
                    "--no-instructions",
                ],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=15,
                check=True,
            )
            intent = PostgresIntent(
                "a" * 32, "synthetic-daemon", "sha256:" + "b" * 64, str(unix), "c" * 64
            )
            # Exercise the actual bootstrap statements generated for the pinned container.
            script = intent.command()[1]
            script = script[
                script.index("postgres --single") : script.index("exec postgres")
            ]
            script = script.replace("/var/lib/postgresql/data", str(data))
            subprocess.run(
                [*command, "/bin/sh", "-ec", script],
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
                check=True,
            )
            log = (root / "postgres.log").open("wb")
            process = subprocess.Popen(
                [
                    *command,
                    str(binary / "postgres"),
                    "-D",
                    str(data),
                    "-c",
                    "listen_addresses=",
                    "-c",
                    f"unix_socket_directories={unix}",
                    "-c",
                    "unix_socket_permissions=0700",
                    "-c",
                    "max_connections=6",
                    "-c",
                    "shared_buffers=24MB",
                ],
                env=env,
                stdout=log,
                stderr=log,
            )
            try:
                end = time.monotonic() + 5
                while not (unix / ".s.PGSQL.5432").exists():
                    self.assertIsNone(process.poll())
                    self.assertLess(time.monotonic(), end)
                    time.sleep(0.02)
                os.chmod(root, 0o700)
                directory, endpoint = unix.stat(), (unix / ".s.PGSQL.5432").stat()
                identity = DatabaseIdentity(
                    intent.run,
                    intent.nonce,
                    directory.st_dev,
                    directory.st_ino,
                    endpoint.st_ino,
                )
                pid = int((data / "postmaster.pid").read_text().splitlines()[0])
                self.assertEqual(pid, process.pid)
                peer = Peer(pid, process_start(Path("/proc") / str(pid), pid))
                descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                # The adapter loads libpq in-process; keep dependency lookup explicit.
                lib = ctypes.CDLL(str(library / "libpq.so.5"))
                from unittest.mock import patch

                from e5a_libpq import load_libpq

                with patch("e5a_libpq.c.CDLL", return_value=lib):
                    load_libpq()

                    def execute(sql):
                        return query(
                            descriptor,
                            identity,
                            intent.run,
                            sql,
                            time.monotonic() + 4,
                            peer=peer,
                        )

                    try:
                        result = workload(execute, intent.run)
                        self.assertEqual(
                            [row["sequence"] for row in result["transactions"]],
                            [1, 2, 3],
                        )
                        self.assertEqual(
                            result["transactions"][2]["outcome"], "COMMITTED_RECONCILED"
                        )
                        self.assertEqual(
                            execute(
                                "BEGIN READ ONLY; /* attest */ SELECT count(*) FROM public.e5a_measurement; COMMIT;"
                            ),
                            ["3"],
                        )
                        with self.assertRaisesRegex(Blocked, "E5A_PG_PEER_IDENTITY"):
                            query(
                                descriptor,
                                identity,
                                intent.run,
                                "BEGIN; /* attest */ SELECT 1; COMMIT;",
                                time.monotonic() + 3,
                                peer=replace(peer, start=peer.start + 1),
                            )
                        before = time.monotonic()
                        with self.assertRaisesRegex(Blocked, "E5A_SQL_FAILED"):
                            execute("BEGIN; /* attest */ SELECT pg_sleep(3); COMMIT;")
                        result["statement_timeout_ms"] = round(
                            (time.monotonic() - before) * 1000
                        )
                        self.assertLess(result["statement_timeout_ms"], 3500)
                        print(json.dumps({"local_postgresql": version, "sql": result}))
                    finally:
                        os.close(descriptor)
            finally:
                if process.poll() is None:
                    process.send_signal(signal.SIGINT)
                    try:
                        process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=2)
                log.close()
                self.assertFalse((data / "postmaster.pid").exists())
