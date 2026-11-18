"""Offline E0a lifecycle tests. No Docker daemon or WB access."""

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from runtime_e0a import (
    IMAGE,
    LABEL,
    LIMITS,
    PHASE,
    TRACE,
    Blocked,
    cleanup,
    command,
    owned_volume,
    run_probe,
    validate_image,
    validate_probe,
    watchdog,
)

CID = "a" * 64
NAME = "wb-lab-01-e0a-test"
RUN = "b" * 32


def volume(label=RUN):
    return {
        "Name": NAME,
        "Labels": {LABEL: label},
        "Driver": "local",
        "Scope": "local",
        "Options": {},
        "CreatedAt": "recorded",
        "Mountpoint": "/test/owned",
    }


def container(label=RUN):
    return {
        "Id": CID,
        "Name": "/" + NAME,
        "Config": {"Labels": {LABEL: label}},
        "State": {"Running": True},
    }


def ledger():
    return {
        "name": NAME,
        "run_id": RUN,
        "container_id": CID,
        "container_create_requested": True,
        "volume_create_requested": True,
        "volume": {"CreatedAt": "recorded", "Mountpoint": "/test/owned"},
    }


class E0aTests(unittest.TestCase):
    def test_command_timeout_records_only_safe_operation(self):
        for operation in (
            ("volume", "create"),
            ("container", "create"),
            ("container", "inspect"),
            ("container", "start"),
        ):
            trace = []
            token = TRACE.set(trace)
            try:
                with (
                    self.subTest(operation=operation),
                    patch("runtime_e0a.time.monotonic", side_effect=[0, 1]),
                    patch(
                        "runtime_e0a.subprocess.run",
                        side_effect=subprocess.TimeoutExpired(
                            ["secret-argument"], 3, output="secret-output"
                        ),
                    ),
                    self.assertRaises(subprocess.TimeoutExpired),
                ):
                    command(30, *operation, "secret-argument")
                self.assertEqual(trace[0]["operation"], ".".join(operation))
                self.assertEqual(trace[0]["error_type"], "TimeoutExpired")
                self.assertNotIn("secret", str(trace))
            finally:
                TRACE.reset(token)

    def test_late_success_is_rejected_by_operation_and_global_deadline(self):
        for operation, deadline, finished in (
            (("container", "start"), 30, 12),
            (("container", "inspect"), 30, 3),
            (("container", "start"), 2, 2),
        ):
            with (
                self.subTest(operation=operation, deadline=deadline),
                patch(
                    "runtime_e0a.time.monotonic", side_effect=[0, finished, finished]
                ),
                patch(
                    "runtime_e0a.subprocess.run",
                    return_value=SimpleNamespace(returncode=0),
                ),
                self.assertRaisesRegex(Blocked, "OVERRAN_DEADLINE"),
            ):
                command(deadline, *operation, "synthetic")

    def test_start_budget_is_clipped_to_global_deadline_and_cleanup_is_separate(self):
        trace = []
        token = TRACE.set(trace)
        phase = PHASE.set("cleanup")
        try:
            with (
                patch("runtime_e0a.time.monotonic", side_effect=[29, 29.5]),
                patch(
                    "runtime_e0a.subprocess.run",
                    return_value=SimpleNamespace(returncode=0),
                ) as run,
            ):
                command(30, "container", "start", CID)
            self.assertEqual(run.call_args.kwargs["timeout"], 1)
            self.assertEqual(trace[0]["phase"], "cleanup")
            self.assertEqual(trace[0]["elapsed_ms"], 500)
        finally:
            TRACE.reset(token)
            PHASE.reset(phase)

    def test_run_timeout_before_and_after_creation_preserves_foreign_inventory(self):
        for fail in ("volume.create", "container.create", "container.start"):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "lab"
                root.mkdir()
                host = {
                    "docker_root": str(Path(directory) / "docker"),
                    "mounts": {"root": {"maj:min": "179:2"}},
                }
                watcher = MagicMock()
                watcher.pid = 123
                watcher.exitcode = 0
                watcher.is_alive.side_effect = [True, False]
                context = MagicMock()
                context.Process.return_value = watcher
                reader, writer = MagicMock(), MagicMock()
                reader.poll.return_value = False
                context.Pipe.return_value = (reader, writer)
                saved = []
                inventory = {
                    "container": {"foreign-id"},
                    "volume": {"foreign-volume"},
                    "network": set(),
                }

                def checked(deadline, kind, verb, *args, fail=fail, host=host):
                    if kind + "." + verb == fail:
                        raise subprocess.TimeoutExpired("synthetic", 3)
                    if kind == "image":
                        return json.dumps(
                            [
                                {
                                    "Id": "sha256:" + CID,
                                    "Os": "linux",
                                    "Architecture": "arm64",
                                    "RepoDigests": [IMAGE],
                                }
                            ]
                        )
                    if kind == "volume":
                        name = args[-1]
                        source = Path(host["docker_root"]) / "volumes" / name / "_data"
                        source.mkdir(parents=True)
                        return name
                    return CID

                def inspected(deadline, kind, reference, host=host):
                    if kind == "container" and reference.startswith("wb-"):
                        return None
                    name = "wb-lab-01-e0a-" + RUN
                    if kind == "volume":
                        return {
                            **volume(),
                            "Name": name,
                            "Labels": {LABEL: RUN},
                            "Mountpoint": str(
                                Path(host["docker_root"]) / "volumes" / name / "_data"
                            ),
                        }
                    return {**container(), "Name": "/" + name}

                with (
                    patch("runtime_e0a.ROOT", root),
                    patch(
                        "runtime_e0a.uuid.uuid4", return_value=SimpleNamespace(hex=RUN)
                    ),
                    patch(
                        "runtime_e0a.multiprocessing.get_context", return_value=context
                    ),
                    patch("runtime_e0a.snapshot", return_value=inventory) as snapshots,
                    patch("runtime_e0a.checked", side_effect=checked),
                    patch("runtime_e0a.inspect", side_effect=inspected),
                    patch(
                        "runtime_e0a.mount",
                        return_value={"maj:min": "179:2", "fstype": "ext4"},
                    ),
                    patch("runtime_e0a.thresholds"),
                    patch("runtime_e0a.mem_available", return_value=1024**3),
                    patch("runtime_e0a.validate_container"),
                    patch("runtime_e0a.cleanup") as cleanup_mock,
                    patch(
                        "runtime_e0a.save",
                        side_effect=lambda path, value, saved=saved: saved.append(
                            copy.deepcopy(value)
                        ),
                    ),
                ):
                    result = run_probe(host)
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(result["reason"], "TimeoutExpired")
                self.assertEqual(result["cleanup"], "CONFIRMED")
                self.assertEqual(result["foreign_inventory"], "PRESERVED")
                self.assertEqual(result["ledger"]["volume_create_requested"], True)
                self.assertEqual(
                    result["ledger"]["container_create_requested"],
                    fail != "volume.create",
                )
                cleanup_mock.assert_called_once()
                self.assertEqual(snapshots.call_count, 2)
                self.assertEqual(saved[-1]["status"], "BLOCKED")

    def test_engine_29_hub_canonical_references_keep_exact_digest(self):
        digest = IMAGE.split("@")[1]
        image = {"Id": "sha256:" + CID, "Architecture": "arm64", "Os": "linux"}
        for repository in (
            "python",
            "library/python",
            "docker.io/python",
            "docker.io/library/python",
            "index.docker.io/python",
            "index.docker.io/library/python",
        ):
            with self.subTest(repository=repository):
                self.assertEqual(
                    validate_image(
                        {**image, "RepoDigests": [repository + "@" + digest]}
                    ),
                    image["Id"],
                )
        for changes in (
            {"RepoDigests": ["python@sha256:" + "f" * 64]},
            {"RepoDigests": ["evil.example/library/python@" + digest]},
            {"RepoDigests": ["docker.io/other/python@" + digest]},
            {"RepoDigests": None},
            {"RepoDigests": [{}]},
            {"RepoDigests": ["python:3.14.3"]},
            {"Architecture": "amd64", "RepoDigests": [IMAGE]},
            {"Os": "windows", "RepoDigests": [IMAGE]},
            {"Id": "sha256:short", "RepoDigests": [IMAGE]},
            {"Variant": "v7", "RepoDigests": [IMAGE]},
        ):
            with (
                self.subTest(changes=changes),
                self.assertRaisesRegex(Blocked, "LOCAL_IMAGE_ID"),
            ):
                validate_image({**image, **changes})

    def test_observed_cgroup_and_network(self):
        observed = {
            "limits": LIMITS,
            "interfaces": ["lo"],
            "device": "179:2",
            "mount_read_only": True,
            "uid": 65532,
        }
        validate_probe(observed, "179:2")
        for change in (
            {"limits": {**LIMITS, "memory.swap.max": "max"}},
            {"interfaces": ["eth0", "lo"]},
            {"device": "8:1"},
            {"mount_read_only": False},
        ):
            with self.subTest(change=change), self.assertRaises(Blocked):
                validate_probe({**observed, **change}, "179:2")

    def test_cleanup_confirms_absence_in_order(self):
        with (
            patch(
                "runtime_e0a.inspect", side_effect=[container(), None, volume(), None]
            ) as inspect,
            patch("runtime_e0a.checked", return_value="") as command,
        ):
            cleanup(12, ledger())
        self.assertEqual(
            [c.args[1:] for c in command.call_args_list],
            [
                ("container", "rm", "--force", CID),
                ("container", "ls", "-aq", "--filter", "volume=" + NAME),
                ("volume", "rm", NAME),
            ],
        )
        self.assertEqual(inspect.call_args.args, (12, "volume", NAME))

    def test_foreign_container_and_replaced_volume_are_preserved(self):
        for observations in (
            [container("foreign")],
            [None, {**volume(), "CreatedAt": "replaced"}],
        ):
            with (
                self.subTest(observations=observations),
                patch("runtime_e0a.inspect", side_effect=observations),
                patch("runtime_e0a.checked") as command,
                self.assertRaisesRegex(Blocked, "OWNERSHIP|IDENTITY_CHANGED"),
            ):
                cleanup(12, ledger())
            command.assert_not_called()

    def test_volume_requires_label(self):
        with self.assertRaisesRegex(Blocked, "VOLUME_OWNERSHIP"):
            owned_volume(volume("foreign"), NAME, RUN)

    def test_still_attached_volume_is_preserved(self):
        with (
            patch("runtime_e0a.inspect", side_effect=[None, volume()]),
            patch("runtime_e0a.checked", return_value="foreign-container") as command,
            self.assertRaisesRegex(Blocked, "VOLUME_STILL_ATTACHED"),
        ):
            cleanup(12, ledger())
        self.assertEqual(command.call_count, 1)

    def test_create_unknown_without_id_is_not_clean(self):
        item = ledger()
        del item["container_id"]
        with (
            patch("runtime_e0a.inspect", return_value=None) as inspect,
            patch("runtime_e0a.checked") as command,
            self.assertRaisesRegex(Blocked, "CREATE_UNCERTAIN"),
        ):
            cleanup(12, item)
        inspect.assert_called_once_with(12, "container", NAME)
        command.assert_not_called()

    def test_unconfirmed_stop_preserves_volume(self):
        with (
            patch("runtime_e0a.inspect", side_effect=[container(), container()]),
            patch("runtime_e0a.checked") as command,
            self.assertRaisesRegex(Blocked, "CONTAINER_REMAINS"),
        ):
            cleanup(12, ledger())
        command.assert_called_once_with(12, "container", "rm", "--force", CID)

    def test_watchdog_invalidates_created_or_running_id_on_low_ram(self):
        for running in (False, True):
            item = container()
            item["State"]["Running"] = running
            with (
                self.subTest(running=running),
                patch("runtime_e0a.time.monotonic", return_value=1),
                patch("runtime_e0a.mem_available", return_value=0),
                patch("runtime_e0a.shutil.disk_usage") as usage,
                patch("runtime_e0a.inspect", side_effect=[item, None]) as inspect,
                patch("runtime_e0a.checked") as command,
                patch("runtime_e0a.multiprocessing.Event") as events,
            ):
                stop, ready = events(), events()
                stop.is_set.return_value = False
                usage.return_value.free = 5 * 1024**3
                with self.assertRaises(SystemExit) as failure:
                    watchdog(30, NAME, RUN, CID, stop, ready)
                self.assertEqual(failure.exception.code, 1)
            command.assert_called_once_with(5, "container", "rm", "--force", CID)
            self.assertEqual(inspect.call_args.args, (5, "container", CID))
