"""Run SIGKILL recovery through real processes and a persistent fake Engine."""

import json
import multiprocessing
import os
import signal
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from e5a_engine import FILE, IMAGE, Engine, Intent, watchdog

OWN = "1" * 64
FOREIGN = "2" * 64
INTENT = Intent("a" * 32, "lab-daemon", "sha256:" + "b" * 64)


class FakeTransport:
    def __init__(self, directory, created, fault):
        self.directory = directory
        self.created = created
        self.fault = fault

    def __call__(self, method, path, body, deadline):
        item = self.directory / "container.json"
        if method == "GET" and path == f"/containers/{FOREIGN}/json":
            return 200, (self.directory / FOREIGN).read_bytes()
        if path == "/info":
            daemon = (
                "other"
                if self.fault == "daemon" and self.created.is_set()
                else INTENT.daemon
            )
            return 200, json.dumps({"ID": daemon}).encode()
        if path == f"/images/{IMAGE}/json":
            return 200, json.dumps(
                {
                    "Id": INTENT.image,
                    "Os": "linux",
                    "Architecture": "arm64",
                    "Variant": "v8",
                    "RepoDigests": [IMAGE],
                    "Config": {"Volumes": None},
                }
            ).encode()
        if method == "POST":
            assert path == f"/containers/create?name={INTENT.name}"
            assert (self.directory / "run" / FILE).is_file()
            with (self.directory / "create").open("xb") as marker:
                marker.write(b"one create")
            if self.fault != "missing":
                if self.fault == "labels":
                    body["Labels"] = {}
                if self.fault == "config":
                    body["HostConfig"]["Binds"] = ["/other:/other"]
                item.write_text(
                    json.dumps(
                        {
                            "Id": OWN,
                            "Name": "/" + INTENT.name,
                            "Image": INTENT.image,
                            "Config": body,
                            "HostConfig": {
                                "Privileged": False,
                                "Binds": None,
                                "VolumesFrom": None,
                                "PortBindings": None,
                                "Devices": [],
                                **body["HostConfig"],
                            },
                            "Mounts": [],
                            "NetworkSettings": {"Ports": {}},
                            "State": {"Status": "created", "Running": False},
                        }
                    ),
                    encoding="ascii",
                )
            self.created.set()
            time.sleep(30)
            raise AssertionError("runner was not killed before create returned")
        if method == "DELETE":
            with (self.directory / "delete").open("a", encoding="ascii") as log:
                log.write(path + "\n")
            assert path == f"/containers/{OWN}?v=false&force=false"
            item.unlink()
            return 204, b""
        assert path in (f"/containers/{OWN}/json", f"/containers/{INTENT.name}/json")
        return (200, item.read_bytes()) if item.exists() else (404, b"{}")


@unittest.skipUnless(hasattr(os, "pidfd_open"), "Linux pidfd and SIGKILL required")
class CreateRecoveryTests(unittest.TestCase):
    def run_crash(self, fault, expected):
        ctx = multiprocessing.get_context("fork")
        with TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / "run"
            run.mkdir(mode=0o700)
            foreign = root / FOREIGN
            foreign_data = {"Id": FOREIGN, "Name": "/foreign-container"}
            foreign.write_text(json.dumps(foreign_data), encoding="ascii")
            fd = os.open(run, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            created = ctx.Event()
            release = ctx.Event()
            engine = Engine(FakeTransport(root, created, fault))
            deadline = time.monotonic() + 15

            def start():
                if release.wait(3):
                    engine.create_controller(fd, INTENT, deadline)

            runner = ctx.Process(target=start)
            runner.start()
            pidfd = os.pidfd_open(runner.pid)
            ready, ready_writer = ctx.Pipe(duplex=False)
            result, result_writer = ctx.Pipe(duplex=False)
            monitor = ctx.Process(
                target=watchdog,
                args=(fd, INTENT, pidfd, engine, deadline, ready_writer, result_writer),
            )
            monitor.start()
            ready_writer.close()
            result_writer.close()
            try:
                self.assertTrue(ready.poll(3))
                self.assertEqual(ready.recv(), monitor.pid)
                self.assertNotEqual(monitor.pid, runner.pid)
                release.set()
                self.assertTrue(created.wait(3))
                if fault == "ledger":
                    (run / FILE).write_bytes(b"changed")
                runner.kill()
                runner.join(3)
                self.assertEqual(runner.exitcode, -signal.SIGKILL)
                self.assertTrue(result.poll(3))
                self.assertEqual(result.recv(), expected)
                monitor.join(3)
                self.assertEqual(monitor.exitcode, 0)
                removed = expected["cleanup"] == "CONFIRMED"
                self.assertEqual((root / "delete").exists(), removed)
                if removed:
                    self.assertEqual(
                        (root / "delete").read_text(encoding="ascii"),
                        f"/containers/{OWN}?v=false&force=false\n",
                    )
                self.assertEqual((root / "create").read_bytes(), b"one create")
                self.assertEqual(
                    (root / "container.json").exists(),
                    not removed and fault != "missing",
                )
                self.assertEqual(engine.inspect(FOREIGN, deadline), foreign_data)
            finally:
                for child in (runner, monitor):
                    if child.is_alive():
                        child.kill()
                    child.join(2)
                for descriptor in (fd, pidfd):
                    os.close(descriptor)
                ready.close()
                result.close()

    def test_created_container_removed_after_runner_sigkill(self):
        self.run_crash(None, {"cleanup": "CONFIRMED", "reason": "E5A_RUNNER_EXITED"})

    def test_ambiguous_ownership_never_removes_container(self):
        for fault, reason in {
            "labels": "E5A_CONTAINER_OWNERSHIP",
            "config": "E5A_CONTAINER_OWNERSHIP",
            "daemon": "E5A_DAEMON_CHANGED",
            "missing": "E5A_CREATE_OUTCOME_UNKNOWN",
            "ledger": "E5A_INTENT_CHANGED",
        }.items():
            with self.subTest(fault=fault):
                self.run_crash(
                    fault, {"cleanup": "CLEANUP_UNCONFIRMED", "reason": reason}
                )
