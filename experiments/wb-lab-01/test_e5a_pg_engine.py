"""Forked watchdog recovery after runner death with a fake persistent Engine."""

import json
import multiprocessing
import os
import signal
import socket
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from e5a_engine import IMAGE as PYTHON_IMAGE
from e5a_engine import Engine, Intent, watchdog
from e5a_pg_engine import IMAGE, PostgresEngine, PostgresIntent, write_record
from e5a_pg_identity import SOCKET_NAME
from e5a_pg_supervisor import PairedRecovery, monitor_sql
from e5a_pg_watermark import WATERMARK
from e5a_sql import workload

CID = "1" * 64
FOREIGN = "2" * 64
CONTROLLER = "3" * 64


class FakeDocker:
    def __init__(self, root, intent, barrier, fault):
        self.root = root
        self.intent = intent
        self.barrier = barrier
        self.fault = fault

    def __call__(self, method, path, body, deadline):
        intent = self.intent
        container = self.root / "container"
        volume = self.root / "volume"

        def reply(value, status=200):
            return status, json.dumps(value).encode()

        if path == "/info":
            return reply(
                {
                    "ID": "changed"
                    if self.fault == "daemon" and self.barrier.is_set()
                    else intent.daemon
                }
            )
        if path == f"/images/{IMAGE}/json":
            return reply(
                {
                    "Id": intent.image,
                    "Os": "linux",
                    "Architecture": "arm64",
                    "RepoDigests": [IMAGE],
                    "Config": {"Volumes": {"/var/lib/postgresql": {}}},
                }
            )
        if path == "/volumes/create":
            volume.write_text(
                json.dumps(
                    {
                        "Name": body["Name"],
                        "Driver": "local",
                        "Scope": "local",
                        "Labels": body["Labels"],
                        "Options": None,
                        "CreatedAt": "test",
                        "Mountpoint": str(self.root / "pgdata"),
                    }
                )
            )
            return 201, volume.read_bytes()
        if path == f"/containers/create?name={intent.name}":
            mounts = [
                {
                    "Type": "bind",
                    "Destination": "/socket",
                    "RW": True,
                    "Source": "/foreign"
                    if self.fault == "mount"
                    else intent.socket_source,
                },
                {
                    "Type": "volume",
                    "Destination": "/var/lib/postgresql",
                    "RW": True,
                    "Name": intent.volume,
                },
            ]
            container.write_text(
                json.dumps(
                    {
                        "Id": CID,
                        "Name": "/" + intent.name,
                        "Image": intent.image,
                        "Config": body,
                        "HostConfig": {"Privileged": False, **body["HostConfig"]},
                        "State": {"Running": False},
                        "Mounts": mounts,
                    }
                )
            )
            if self.fault == "lost_create":
                self.barrier.set()
                time.sleep(20)
            return reply({"Id": CID}, 201)
        if path in (f"/containers/{CID}/start", f"/containers/{CID}/stop?t=1"):
            item = json.loads(container.read_bytes())
            item["State"]["Running"] = (
                path.endswith("/start") and self.fault != "pg_crash"
            )
            container.write_text(json.dumps(item))
            if self.fault == "start_timeout" and path.endswith("/start"):
                self.barrier.set()
                time.sleep(20)
            return 204, b""
        if path.startswith("/containers/json?"):
            return reply([{"Id": FOREIGN}] if self.fault == "attachment" else [])
        if path == f"/containers/{FOREIGN}/json":
            return reply({"Id": FOREIGN})
        if method == "GET":
            assert path in (
                f"/containers/{intent.name}/json",
                f"/containers/{CID}/json",
                f"/volumes/{intent.volume}",
            )
            resource = volume if path.startswith("/volumes/") else container
            return (200, resource.read_bytes()) if resource.exists() else (404, b"")
        assert method == "DELETE"
        assert path in (
            f"/containers/{CID}?v=false&force=false",
            f"/volumes/{intent.volume}",
        )
        resource = volume if path.startswith("/volumes/") else container
        resource.unlink()
        if self.fault == "watchdog_crash" and resource == container:
            os._exit(72)
        return 204, b""


@unittest.skipUnless(
    hasattr(os, "pidfd_open") and os.geteuid() == 0, "isolated Linux UID 999 fixture"
)
class RecoveryTests(unittest.TestCase):
    def test_paired_watchdog_during_transaction(self):
        for fault, reason in {
            "sigkill": "E5A_RUNNER_EXITED",
            "watchdog_crash": "E5A_RUNNER_EXITED",
            "watermark": "E5A_PG_DATA_WATERMARK",
            "missing": "FileNotFoundError",
            "attachment": "E5A_PG_DATA_WATERMARK",
            "success": None,
        }.items():
            with self.subTest(fault=fault), TemporaryDirectory() as path:
                self.paired_transaction(Path(path), fault, reason)

    def paired_transaction(self, root, fault, reason):
        ctx = multiprocessing.get_context("fork")
        endpoint = root / "pg-socket"
        endpoint.mkdir(mode=0o700)
        os.chown(endpoint, 999, 999)
        data = root / "pgdata"
        data.mkdir()
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        prepared, proceed, active, finished = (ctx.Event() for _ in range(4))
        pg = PostgresIntent(
            "a" * 32, "daemon", "sha256:" + "b" * 64, str(endpoint), "d" * 64
        )
        controller = Intent(pg.run, pg.daemon, "sha256:" + "c" * 64)
        pg_transport = FakeDocker(root, pg, active, fault)
        controller_file = root / "controller"

        def transport(method, path, body, deadline):
            if path == f"/images/{PYTHON_IMAGE}/json":
                return 200, json.dumps(
                    {
                        "Id": controller.image,
                        "Os": "linux",
                        "Architecture": "arm64",
                        "RepoDigests": [PYTHON_IMAGE],
                        "Config": {},
                    }
                ).encode()
            if path == f"/containers/create?name={controller.name}":
                controller_file.write_text(
                    json.dumps(
                        {
                            "Id": CONTROLLER,
                            "Image": controller.image,
                            "Name": "/" + controller.name,
                            "Config": body,
                            "HostConfig": {"Privileged": False, **body["HostConfig"]},
                            "Mounts": [],
                            "State": {"Status": "created", "Running": False},
                        }
                    )
                )
                return 201, json.dumps({"Id": CONTROLLER}).encode()
            if path in (
                f"/containers/{controller.name}/json",
                f"/containers/{CONTROLLER}/json",
            ):
                return (
                    (200, controller_file.read_bytes())
                    if controller_file.exists()
                    else (404, b"")
                )
            if path == f"/containers/{CONTROLLER}?v=false&force=false":
                assert method == "DELETE"
                controller_file.unlink()
                return 204, b""
            return pg_transport(method, path, body, deadline)

        engine = Engine(transport)
        backend = PostgresEngine(
            engine, lambda *_: (data.stat().st_dev, data.stat().st_ino)
        )
        paired = PairedRecovery(backend, pg, controller)
        deadline = time.monotonic() + 10

        def run():
            engine.create_controller(fd, controller, deadline)
            backend.create(fd, pg, deadline)
            prepared.set()
            if proceed.wait(3):
                if fault == "success":
                    active.set()
                    finished.set()
                    time.sleep(10)
                    return

                def execute(sql):
                    assert sql.startswith("BEGIN;") and "INSERT" in sql
                    active.set()
                    time.sleep(10)
                    raise AssertionError("transaction should have been interrupted")

                workload(execute, pg.run)
                (root / "continued").touch()

        runner = ctx.Process(target=run)
        runner.start()
        pidfd = os.pidfd_open(runner.pid)
        ready, ready_out = ctx.Pipe(duplex=False)
        result, result_out = ctx.Pipe(duplex=False)
        monitor = ctx.Process(
            target=monitor_sql,
            args=(fd, paired, pidfd, deadline - 3, deadline, ready_out, result_out),
            kwargs={"finished": finished},
        )
        try:
            self.assertTrue(prepared.wait(2))
            with socket.socket(socket.AF_UNIX) as stale:
                stale.bind(str(endpoint / SOCKET_NAME))
            (endpoint / (SOCKET_NAME + ".lock")).write_text("synthetic lock")
            entries = {}
            for entry in endpoint.iterdir():
                os.chown(entry, 999, 999)
                info = entry.stat()
                entries[entry.name] = [info.st_dev, info.st_ino]
            write_record(fd, "pg-socket-entries.json", entries)
            monitor.start()
            self.assertTrue(ready.poll(2))
            self.assertEqual(ready.recv(), monitor.pid)
            proceed.set()
            self.assertTrue(active.wait(2))
            if fault in {"sigkill", "watchdog_crash"}:
                runner.kill()
            elif fault == "missing":
                (root / "pg-data.json").unlink()
            elif fault != "success":
                with (data / "growth").open("wb") as stream:
                    stream.truncate(WATERMARK)
            if fault == "watchdog_crash":
                monitor.join(2)
                self.assertEqual(monitor.exitcode, 72)
                self.assertFalse((root / "container").exists())
                self.assertTrue(controller_file.exists())
                self.assertFalse((root / "paired-cleanup.json").exists())
                monitor = ctx.Process(
                    target=monitor_sql,
                    args=(
                        fd,
                        paired,
                        pidfd,
                        deadline - 3,
                        deadline,
                        ready_out,
                        result_out,
                    ),
                )
                monitor.start()
            self.assertTrue(result.poll(3))
            actual = result.recv()
            confirmed = fault != "attachment"
            expected = {
                "status": "BLOCKED" if reason else "SQL_PHASE_COMPLETE",
                "cleanup": "CONFIRMED" if confirmed else "CLEANUP_UNCONFIRMED",
            }
            if reason:
                expected["reason"] = reason
            self.assertEqual(actual, expected)
            self.assertFalse((root / "continued").exists())
            self.assertFalse((root / "container").exists())
            self.assertEqual(controller_file.exists(), not confirmed)
            self.assertEqual(endpoint.exists(), not confirmed)
            self.assertEqual(engine.inspect(FOREIGN, deadline), {"Id": FOREIGN})
            self.assertEqual(
                json.loads((root / "paired-cleanup.json").read_bytes()), actual
            )
        finally:
            for child in (runner, monitor):
                if child.pid is not None:
                    if child.is_alive():
                        child.kill()
                    child.join(2)
            for pipe in (ready, ready_out, result, result_out):
                pipe.close()
            os.close(pidfd)
            os.close(fd)

    def test_watchdog_recovers_after_runner_sigkill(self):
        for fault, confirmed in {
            "transaction": True,
            "lost_create": True,
            "start_timeout": True,
            "pg_crash": True,
            "attachment": False,
            "mount": False,
            "daemon": False,
            "ledger": False,
            "watchdog_crash": True,
        }.items():
            with self.subTest(fault=fault), TemporaryDirectory() as path:
                self.crash(Path(path), fault, confirmed)

    def crash(self, root, fault, confirmed):
        ctx = multiprocessing.get_context("fork")
        endpoint = root / "pg-socket"
        endpoint.mkdir(mode=0o700)
        os.chown(endpoint, 999, 999)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        barrier = ctx.Event()
        release = ctx.Event()
        intent = PostgresIntent(
            "a" * 32, "daemon", "sha256:" + "b" * 64, str(endpoint), "d" * 64
        )
        backend = PostgresEngine(
            Engine(FakeDocker(root, intent, barrier, fault)), lambda *args: None
        )
        deadline = time.monotonic() + 12

        def runner_main():
            if release.wait(2):
                try:
                    backend.create(fd, intent, deadline)
                    if fault == "transaction":

                        def execute(sql):
                            assert sql.startswith("BEGIN;") and "INSERT" in sql
                            (root / "transaction-open").write_text("ACTIVE")
                            barrier.set()
                            time.sleep(20)
                            raise AssertionError("runner was not killed")

                        workload(execute, intent.run)
                        (root / "next-workload").touch()
                finally:
                    barrier.set()
                    time.sleep(20)

        runner = ctx.Process(target=runner_main)
        runner.start()
        pidfd = os.pidfd_open(runner.pid)
        ready, ready_out = ctx.Pipe(duplex=False)
        result, result_out = ctx.Pipe(duplex=False)
        monitor = ctx.Process(
            target=watchdog,
            args=(fd, intent, pidfd, backend, deadline, ready_out, result_out),
        )
        monitor.start()
        ready_out.close()
        result_out.close()
        try:
            self.assertTrue(ready.poll(2))
            self.assertEqual(ready.recv(), monitor.pid)
            release.set()
            self.assertTrue(barrier.wait(2))
            if fault == "ledger":
                (root / "pg-volume.json").write_text("broken")
            runner.kill()
            runner.join(2)
            self.assertEqual(runner.exitcode, -signal.SIGKILL)
            if fault == "transaction":
                self.assertEqual((root / "transaction-open").read_text(), "ACTIVE")
                self.assertFalse((root / "next-workload").exists())
            if fault == "watchdog_crash":
                monitor.join(2)
                self.assertEqual(monitor.exitcode, 72)
                self.assertFalse((root / "container").exists())
                self.assertTrue((root / "volume").exists())
                backend.recover(fd, intent, deadline)
            else:
                self.assertTrue(result.poll(2))
                self.assertEqual(
                    result.recv()["cleanup"],
                    "CONFIRMED" if confirmed else "CLEANUP_UNCONFIRMED",
                )
            self.assertEqual((root / "volume").exists(), not confirmed)
            self.assertEqual(
                (root / "container").exists(), not confirmed and fault != "attachment"
            )
            self.assertEqual(backend.engine.inspect(FOREIGN, deadline), {"Id": FOREIGN})
            if confirmed:
                backend.recover(fd, intent, deadline)
        finally:
            for child in (runner, monitor):
                if child.is_alive():
                    child.kill()
                child.join(2)
            ready.close()
            result.close()
            os.close(pidfd)
            os.close(fd)
