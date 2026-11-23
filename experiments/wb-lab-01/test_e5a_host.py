"""Full real-process campaign over a persistent fake Docker HTTP boundary."""

import hashlib
import json
import os
import socket
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from e5a_engine import IMAGE as PY_IMAGE
from e5a_evidence import publish
from e5a_host import HostBackend
from e5a_pg_engine import IMAGE as PG_IMAGE
from e5a_pg_engine import write_record
from preflight import Blocked, mount
from runtime_e5a import PHASE_LIMITS, process_sample, run_campaign


class Transport:
    def __init__(self, directory):
        self.directory = directory
        self.pid = os.getpid()
        self.inventory_started = False
        (directory / "containers").mkdir()
        (directory / "volumes").mkdir()

    def files(self):
        return [
            file
            for file in (self.directory / "containers").iterdir()
            if file.suffix != ".tmp"
        ]

    def __call__(self, method, path, body, deadline):
        def reply(value, code=200):
            return code, json.dumps(value).encode()

        if path == "/info":
            return reply({"ID": "fake-daemon"})
        if path.startswith("/images/"):
            pg = PG_IMAGE in path
            image = "sha256:" + ("b" if pg else "a") * 64
            return reply(
                {
                    "Id": image,
                    "Architecture": "arm64",
                    "Os": "linux",
                    "RepoDigests": [PG_IMAGE if pg else PY_IMAGE],
                    "Config": {"Volumes": {"/var/lib/postgresql": {}} if pg else None},
                }
            )
        if path == "/volumes/create":
            target = self.directory / "volumes" / body["Name"] / "_data"
            target.mkdir(parents=True)
            (target.parent / "labels.json").write_text(json.dumps(body["Labels"]))
            return reply({"Name": body["Name"]}, 201)
        if path.startswith("/volumes/"):
            name = path.split("/")[2]
            target = self.directory / "volumes" / name
            if not target.exists():
                return 404, b""
            if method == "DELETE":
                # Test fixture removes only a volume whose usage API reports empty.
                import shutil

                shutil.rmtree(target)
                return 204, b""
            return reply(
                {
                    "Name": name,
                    "Mountpoint": str(target / "_data"),
                    "CreatedAt": "fake-created",
                    "Driver": "local",
                    "Scope": "local",
                    "Options": None,
                    "Labels": json.loads((target / "labels.json").read_bytes()),
                }
            )
        if path.startswith("/containers/create?name="):
            name = path.split("=", 1)[1]
            cid = hashlib.sha256(name.encode("ascii")).hexdigest()
            mounts = []
            for entry in body["HostConfig"]["Mounts"]:
                destination = entry["Target"]
                if entry["Type"] == "bind":
                    mounts.append(
                        {
                            "Type": "bind",
                            "Source": entry["Source"],
                            "Destination": destination,
                            "RW": True,
                        }
                    )
                else:
                    mounts.append(
                        {
                            "Type": "volume",
                            "Name": entry["Source"],
                            "Source": str(
                                self.directory / "volumes" / entry["Source"] / "_data"
                            ),
                            "Destination": destination,
                            "RW": True,
                        }
                    )
            value = {
                "Id": cid,
                "Name": "/" + name,
                "Image": body["Image"],
                "Config": body,
                "HostConfig": {"Privileged": False, **body["HostConfig"]},
                "Mounts": mounts,
                "NetworkSettings": {"Ports": {}},
                "State": {"Running": False, "Status": "created", "Pid": self.pid},
            }
            (self.directory / "containers" / name).write_text(json.dumps(value))
            return reply({"Id": cid}, 201)
        if path.startswith("/containers/json?"):
            from urllib.parse import parse_qs, urlsplit

            filters = json.loads(parse_qs(urlsplit(path).query)["filters"][0])
            volume = filters["volume"][0]
            data = [json.loads(file.read_bytes()) for file in self.files()]
            return reply(
                [
                    {"Id": item["Id"]}
                    for item in data
                    if any(entry.get("Name") == volume for entry in item["Mounts"])
                ]
            )
        ref = path.split("/")[2].split("?")[0]
        candidates = [
            file
            for file in self.files()
            if ref in (file.name, json.loads(file.read_bytes())["Id"])
        ]
        if not candidates:
            return 404, b""
        (file,) = candidates
        value = json.loads(file.read_bytes())
        if method == "DELETE":
            assert not value["State"]["Running"]
            file.unlink()
            return 204, b""
        if path.endswith("/start") or "/stop?" in path:
            value["State"]["Running"] = path.endswith("/start")
            value["State"]["Status"] = (
                "running" if value["State"]["Running"] else "exited"
            )
            if value["Image"].endswith("b" * 64):
                endpoint = Path(value["Mounts"][0]["Source"]) / ".s.PGSQL.5432"
                if path.endswith("/start"):
                    with socket.socket(socket.AF_UNIX) as listener:
                        listener.bind(str(endpoint))
                    os.chown(endpoint, 999, 999)
                    os.chmod(endpoint, 0o700)
                elif endpoint.exists():
                    endpoint.unlink()
            temporary = file.with_suffix(".tmp")
            temporary.write_text(json.dumps(value))
            temporary.replace(file)
            return 204, b""
        return reply(value)

    def inventory(self, deadline):
        if not self.inventory_started:
            self.inventory_started = True
            time.sleep(0.3)
        return {
            "container": {json.loads(file.read_bytes())["Id"] for file in self.files()},
            "volume": {file.name for file in (self.directory / "volumes").iterdir()},
            "network": {"foreign-network"},
        }


@unittest.skipUnless(
    hasattr(os, "pidfd_open") and os.geteuid() == 0,
    "requires isolated Linux root fixtures",
)
class HostCampaignTests(unittest.TestCase):
    def test_watchdog_survives_a_runner_that_stops_reading_and_rejects_final_abort(
        self,
    ):
        from e5a_engine import Engine

        with TemporaryDirectory() as directory:
            root = Path(directory)
            daemon = root / "docker"
            daemon.mkdir()
            transport = Transport(daemon)
            run = root / "run"
            run.mkdir(mode=0o700)
            fd = os.open(run, os.O_RDONLY | os.O_DIRECTORY)
            host = {
                "daemon_id": "fake-daemon",
                "docker_root": str(daemon),
                "mounts": {"root": mount(root)},
                "nonce": "d" * 64,
            }
            images = {
                "controller": "sha256:" + "a" * 64,
                "postgres": "sha256:" + "b" * 64,
            }
            backend = HostBackend(fd, "c" * 32, host, images, engine=Engine(transport))
            try:
                with (
                    patch(
                        "e5a_host.Infrastructure.sample",
                        return_value={
                            "status": "AVAILABLE",
                            "processes": [
                                {
                                    "role": "docker",
                                    "pid": 900,
                                    "start_before": 1,
                                    "start_after": 1,
                                    "rss_bytes": 4096,
                                    "cpu_user_ticks": 0,
                                    "cpu_system_ticks": 0,
                                }
                            ],
                        },
                    ),
                    patch("e5a_host.ROOT", root),
                    patch("e5a_host.mem_available", return_value=1024**3),
                ):
                    backend.start_watchdog(time.monotonic() + 7)
                    backend.watch.join(4)
                    self.assertFalse(backend.watch.is_alive())
                    self.assertTrue(backend.abort.is_set())
                    report = json.loads((run / "watchdog-abort.json").read_bytes())
                    self.assertEqual(report["reason"], "E5A_RUNNER_HEARTBEAT")
                    self.assertEqual(
                        json.loads((run / "watchdog-cleanup.json").read_bytes())[
                            "cleanup"
                        ],
                        "CONFIRMED",
                    )
                    with self.assertRaisesRegex(Blocked, "E5A_RUNNER_HEARTBEAT"):
                        backend.stop_watchdog(time.monotonic() + 1)
                    self.assertTrue(backend.watchdog_cleanup_confirmed())
                    (run / "watchdog-cleanup.json").unlink()
                    self.assertFalse(backend.watchdog_cleanup_confirmed())
                    write_record(
                        fd,
                        "watchdog-cleanup.json",
                        {"cleanup": "CONFIRMED", "reason": "OTHER_ERROR"},
                    )
                    self.assertFalse(backend.watchdog_cleanup_confirmed())
                    self.assertEqual(transport.inventory(0)["container"], set())
            finally:
                if backend.watch is not None and backend.watch.is_alive():
                    backend.watch.kill()
                    backend.watch.join(1)
                backend.close()
                os.close(fd)

    def test_concrete_backend_campaign_and_process_supervision(self):
        from e5a_engine import Engine

        with TemporaryDirectory() as directory:
            root = Path(directory)
            daemon = root / "docker"
            daemon.mkdir()
            transport = Transport(daemon)
            run = root / "run"
            run.mkdir(mode=0o700)
            fd = os.open(run, os.O_RDONLY | os.O_DIRECTORY)
            host = {
                "daemon_id": "fake-daemon",
                "docker_root": str(daemon),
                "mounts": {"root": mount(root)},
                "nonce": "d" * 64,
            }
            images = {
                "controller": "sha256:" + "a" * 64,
                "postgres": "sha256:" + "b" * 64,
            }
            backend = HostBackend(fd, "c" * 32, host, images, engine=Engine(transport))

            def reading(pid, start, cid):
                pg = any(
                    item["Id"] == cid and item["Image"].endswith("b" * 64)
                    for item in (
                        json.loads(file.read_bytes()) for file in transport.files()
                    )
                )
                limits = PHASE_LIMITS["postgres_controller"][
                    "postgres" if pg else "controller"
                ]
                return {
                    "limits": limits,
                    "memory_current": 1024,
                    "memory_peak": 2048,
                    "memory_events": {},
                    "oom": 0,
                    "oom_kill": 0,
                    "cpu": dict.fromkeys(
                        (
                            "usage_usec",
                            "user_usec",
                            "system_usec",
                            "nr_throttled",
                            "throttled_usec",
                        ),
                        0,
                    ),
                    "io": dict.fromkeys(("rbytes", "wbytes", "rios", "wios"), 0),
                    "pids_current": 1,
                }, process_sample(pid, start)

            def ready(pg, directory, intent, deadline):
                endpoint = Path(intent.socket_source) / ".s.PGSQL.5432"
                info = endpoint.stat()
                write_record(
                    directory,
                    "pg-socket-entries.json",
                    {endpoint.name: [info.st_dev, info.st_ino]},
                )

            try:
                with (
                    patch(
                        "runtime_e0b.mount",
                        return_value={**host["mounts"]["root"], "fstype": "ext4"},
                    ),
                    patch(
                        "e5a_host.Infrastructure.sample",
                        return_value={
                            "status": "AVAILABLE",
                            "processes": [
                                {
                                    "role": "docker",
                                    "pid": 900,
                                    "start_before": 1,
                                    "start_after": 1,
                                    "rss_bytes": 4096,
                                    "cpu_user_ticks": 0,
                                    "cpu_system_ticks": 0,
                                }
                            ],
                        },
                    ),
                    patch("e5a_host.snapshot", transport.inventory),
                    patch("e5a_host.container_reading", reading),
                    patch("e5a_host.PostgresEngine.ready", ready),
                    patch(
                        "e5a_host.workload",
                        return_value={
                            "transactions": [
                                {
                                    "sequence": index,
                                    "outcome": "COMMITTED"
                                    if index < 3
                                    else "COMMITTED_RECONCILED",
                                    "duration_us": 10,
                                }
                                for index in range(1, 4)
                            ],
                            "row_lock": {"lock_timeout": True, "duration_us": 1000000},
                        },
                    ),
                    patch(
                        "e5a_host.MediaController.measurement", return_value=[1, 2, 3]
                    ),
                    patch("e5a_host.mem_available", return_value=1024**3),
                    patch("e5a_host.ROOT", root),
                ):
                    result = run_campaign(backend)
                self.assertEqual(
                    result["status"],
                    "E5A_CHECKS_PASS",
                    (
                        result.get("reason"),
                        (run / "watchdog-abort.json").read_text()
                        if (run / "watchdog-abort.json").exists()
                        else "no abort",
                        (run / "controller" / "workload-error.json").read_text()
                        if (run / "controller" / "workload-error.json").exists()
                        else "no worker error",
                    ),
                )
                self.assertEqual(result["cleanup"], "CONFIRMED")
                self.assertEqual(result["foreign_inventory"], "PRESERVED")
                self.assertEqual(transport.inventory(0)["container"], set())
                self.assertEqual(transport.inventory(0)["volume"], set())
                envelope = {
                    "revision": "a" * 40,
                    "run_id": backend.run,
                    "daemon": backend.daemon,
                    "images": images,
                    "resources": backend.resources,
                    "campaign": result,
                }
                digest = publish(fd, envelope)
                self.assertEqual(
                    digest,
                    hashlib.sha256((run / "evidence.json").read_bytes()).hexdigest(),
                )
            finally:
                if backend.worker is not None and backend.worker.is_alive():
                    backend.worker.kill()
                    backend.worker.join(2)
                if backend.watch is not None and backend.watch.is_alive():
                    backend.stopped.set()
                    backend.watch.join(2)
                    if backend.watch.is_alive():
                        backend.watch.kill()
                        backend.watch.join(2)
                backend.close()
                os.close(fd)
