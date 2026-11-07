"""Offline E0b acceptance: fake CLI only, never creates Docker/PG resources."""

import json
import subprocess
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import runtime_e0b as lab

RUN = "b" * 32
CID = "a" * 64


def portable_save(path, evidence):
    # Host orchestration is mocked on Windows; Linux CI exercises real fd/fsync separately.
    path.write_text(json.dumps(evidence), encoding="utf-8")


class E0bTests(unittest.TestCase):
    def test_gate_precedes_all_read_and_write_operations(self):
        for args in ([], ["OWNER_E0A_RUNTIME_APPROVED"], [lab.APPROVAL, "extra"]):
            with (
                patch.object(lab.sys, "argv", ["runtime_e0b.py", *args]),
                patch.object(lab, "collect") as collect,
                patch.object(lab, "run") as run,
                self.assertRaisesRegex(lab.Blocked, "OWNER_E0B"),
            ):
                lab.main()
            collect.assert_not_called()
            run.assert_not_called()

    def test_exact_pinned_digest_and_official_alias_only(self):
        item = {
            "Id": "sha256:" + CID,
            "Os": "linux",
            "Architecture": "arm64",
            "RepoDigests": [lab.IMAGE.replace("docker.io/library/", "")],
        }
        self.assertEqual(lab.validate_image(item), "sha256:" + CID)
        for change in (
            {"Os": "windows"},
            {"Architecture": "amd64"},
            {"RepoDigests": [lab.IMAGE.replace("library", "attacker")]},
            {"RepoDigests": ["postgres@sha256:" + "0" * 64]},
        ):
            with self.subTest(change=change), self.assertRaises(lab.Blocked):
                lab.validate_image({**item, **change})

    def test_timeout_and_late_success_are_safely_reported(self):
        trace = []
        with (
            patch.object(lab.time, "monotonic", side_effect=[0, 5, 5]),
            patch.object(
                lab.subprocess, "run", return_value=SimpleNamespace(returncode=0)
            ),
            self.assertRaisesRegex(lab.Blocked, "LATE_COMMAND"),
        ):
            lab.cli(30, trace, "container", "exec", "private-argument")
        self.assertNotIn("private", json.dumps(trace))
        trace = []
        with (
            patch.object(
                lab.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("private", 1),
            ),
            self.assertRaises(subprocess.TimeoutExpired),
        ):
            lab.cli(lab.time.monotonic() + 1, trace, "container", "exec", "private")
        self.assertEqual(trace[0]["error_type"], "TimeoutExpired")

    def test_readiness_success_refusal_exhaustion_and_watchdog(self):
        stop = MagicMock()
        stop.is_set.return_value = False
        with patch.object(
            lab,
            "cli",
            side_effect=[SimpleNamespace(returncode=2), SimpleNamespace(returncode=0)],
        ):
            lab.ready(lab.time.monotonic() + 30, [], CID, stop)
        for code in (2, 125):
            with (
                patch.object(lab, "cli", return_value=SimpleNamespace(returncode=code)),
                self.assertRaises(lab.Blocked),
            ):
                lab.ready(lab.time.monotonic() + 30, [], CID, stop)
        stop.is_set.return_value = True
        with patch.object(lab, "cli") as cli, self.assertRaises(lab.Blocked):
            lab.ready(lab.time.monotonic() + 30, [], CID, stop)
        cli.assert_not_called()

    @unittest.skipUnless(
        lab.sys.platform == "linux", "Linux directory-fd semantics; exercised in CI"
    )
    def test_seed_is_exclusive_and_existing_or_symlinked_data_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            owned = root / "owned"
            owned.mkdir()
            lab.seed_volume(owned, "x" * 64, False)
            expected = lab.hashlib.sha256(b"x" * 64).hexdigest()
            self.assertEqual(lab.sentinel_hash(owned), expected)
            with self.assertRaisesRegex(lab.Blocked, "NOT_EMPTY"):
                lab.seed_volume(owned, "y" * 64, False)
            self.assertEqual(lab.sentinel_hash(owned), expected)
            if hasattr(lab.os, "O_NOFOLLOW") and lab.sys.platform != "win32":
                link = root / "link"
                link.symlink_to(owned, target_is_directory=True)
                with self.assertRaises(OSError):
                    lab.seed_volume(link, "z" * 64, False)

    def test_cleanup_orders_writer_before_volumes_and_never_foreign(self):
        ledger = {
            "run_id": RUN,
            "name": "own",
            "container_id": CID,
            "container_create_requested": True,
            "volumes": {
                role: {
                    "name": "own-" + role,
                    "requested": True,
                    "identity": {"CreatedAt": "known", "Mountpoint": "/owned/" + role},
                }
                for role in ("pg", "media")
            },
        }
        with patch.object(lab.base, "cleanup") as cleanup:
            lab.cleanup(10, ledger)
        calls = [c.args[1] for c in cleanup.call_args_list]
        self.assertTrue(calls[0]["container_create_requested"])
        self.assertFalse(calls[0]["volume_create_requested"])
        self.assertEqual([c["name"] for c in calls[1:]], ["own-pg", "own-media"])
        self.assertTrue(all(not c["container_create_requested"] for c in calls[1:]))
        with (
            patch.object(
                lab.base, "cleanup", side_effect=lab.Blocked("CONTAINER_OWNERSHIP")
            ) as cleanup,
            self.assertRaises(lab.Blocked),
        ):
            lab.cleanup(10, ledger)
        self.assertEqual(cleanup.call_count, 1)

    def test_cleanup_retains_id_discovered_after_partial_create(self):
        ledger = {
            "run_id": RUN,
            "name": "own",
            "container_create_requested": True,
            "volumes": {},
        }

        def discover_then_fail(deadline, writer):
            writer["container_id"] = CID
            raise lab.Blocked("CLEANUP_UNCONFIRMED")

        with (
            patch.object(lab.base, "cleanup", side_effect=discover_then_fail),
            self.assertRaises(lab.Blocked),
        ):
            lab.cleanup(10, ledger)
        self.assertEqual(ledger["container_id"], CID)

    def test_sql_uses_stdin_and_identity_mismatch_blocks(self):
        with patch.object(lab, "checked", return_value="row") as cli:
            self.assertEqual(
                lab.sql(30, [], CID, "postgres", "SELECT synthetic"), "row"
            )
        self.assertNotIn("SELECT synthetic", cli.call_args.args)
        self.assertEqual(cli.call_args.kwargs["input_text"], "SELECT synthetic")
        with (
            patch.object(
                lab,
                "sql",
                side_effect=[
                    "",
                    "",
                    json.dumps(
                        {
                            "database": "foreign",
                            "data_directory": "/foreign",
                            "system_identifier": "1",
                        }
                    ),
                ],
            ),
            self.assertRaisesRegex(lab.Blocked, "DATABASE_IDENTITY"),
        ):
            lab.verify_database(
                30, [], {"run_id": RUN, "container_id": CID, "db_sentinel": "x"}
            )

    def test_volume_binding_refuses_foreign_label_driver_source_and_device(self):
        with tempfile.TemporaryDirectory() as directory:
            name = "wb-lab-01-e0b-" + RUN + "-pg"
            source = Path(directory) / "volumes" / name / "_data"
            source.mkdir(parents=True)
            host = {"docker_root": directory, "mounts": {"root": {"maj:min": "179:2"}}}
            item = {
                "Name": name,
                "Labels": {lab.LABEL: RUN},
                "Driver": "local",
                "Scope": "local",
                "Options": {},
                "Mountpoint": str(source),
            }
            with patch.object(
                lab, "mount", return_value={"maj:min": "179:2", "fstype": "ext4"}
            ):
                self.assertEqual(lab.volume_source(item, host, RUN, name), source)
                for change in (
                    {"Labels": {lab.LABEL: "foreign"}},
                    {"Name": "foreign"},
                    {"Driver": "nfs"},
                    {"Options": {"device": "/foreign"}},
                    {"Mountpoint": str(Path(directory) / "foreign")},
                ):
                    with self.subTest(change=change), self.assertRaises(lab.Blocked):
                        lab.volume_source({**item, **change}, host, RUN, name)
            for info in (
                {"maj:min": "0:1", "fstype": "ext4"},
                {"maj:min": "179:2", "fstype": "tmpfs"},
            ):
                with (
                    patch.object(lab, "mount", return_value=info),
                    self.assertRaises(lab.Blocked),
                ):
                    lab.volume_source(item, host, RUN, name)

    def test_sql_rejects_untrusted_identifier_before_queries(self):
        with patch.object(lab, "sql") as sql, self.assertRaises(lab.Blocked):
            lab.verify_database(30, [], {"run_id": "'; DROP DATABASE x;--"})
        sql.assert_not_called()

    def test_run_errors_before_creation_preserve_inventory_and_evidence(self):
        for error in (
            lab.Blocked("E0B_LOCAL_IMAGE_ID"),
            KeyboardInterrupt(),
            subprocess.TimeoutExpired("private", 3),
        ):
            with (
                tempfile.TemporaryDirectory() as directory,
                patch.object(lab, "ROOT", Path(directory)),
                patch.object(
                    lab.multiprocessing, "get_context", return_value=MagicMock()
                ),
                patch.object(lab.base, "save", side_effect=portable_save),
                patch.object(
                    lab.base, "snapshot", return_value={"volume": {"foreign"}}
                ),
                patch.object(lab.base, "inspect", return_value=None),
                patch.object(lab, "checked", side_effect=error),
                patch.object(lab, "cleanup") as cleanup,
            ):
                result = lab.run({})
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(result["cleanup"], "CONFIRMED")
                self.assertEqual(result["foreign_inventory"], "PRESERVED")
                self.assertFalse(result["ledger"]["container_create_requested"])
                self.assertTrue(
                    all(
                        not v["requested"] for v in result["ledger"]["volumes"].values()
                    )
                )
                cleanup.assert_called_once()
                self.assertTrue(
                    (
                        Path(directory) / result["ledger"]["run_id"] / "evidence.json"
                    ).is_file()
                )

    def test_uncertain_cleanup_cannot_pass(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(lab, "ROOT", Path(directory)),
            patch.object(lab.multiprocessing, "get_context", return_value=MagicMock()),
            patch.object(lab.base, "save", side_effect=portable_save),
            patch.object(lab.base, "snapshot", return_value={"volume": set()}),
            patch.object(lab.base, "inspect", return_value=None),
            patch.object(lab, "checked", side_effect=KeyboardInterrupt),
            patch.object(
                lab, "cleanup", side_effect=lab.Blocked("OWNERSHIP_UNCONFIRMED")
            ),
        ):
            result = lab.run({})
        self.assertEqual(result["cleanup"], "CLEANUP_UNCONFIRMED")
        self.assertEqual(result["status"], "BLOCKED")

    def fake_run(self, failure=None, watchdog_exit=0):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory)
            state, tokens = {}, {}

            def checked(deadline, trace, *args, **kwargs):
                operation = ".".join(args[:2])
                if operation == failure:
                    raise subprocess.TimeoutExpired("synthetic", 1)
                if operation == "image.inspect":
                    return json.dumps([{"Id": "sha256:" + CID}])
                if operation == "volume.create":
                    return args[-1]
                if operation == "container.create":
                    state["name"] = args[args.index("--name") + 1]
                    state["run"] = state["name"].split("e0b-")[1]
                    return CID
                if operation == "container.exec":
                    if "sha256sum" in args:
                        return "\n".join(
                            lab.hashlib.sha256(t.encode()).hexdigest() + "  " + p
                            for t, p in zip(
                                tokens.values(),
                                [
                                    "/var/lib/postgresql/e0b.sentinel",
                                    "/media/e0b.sentinel",
                                ],
                                strict=True,
                            )
                        )
                    if "ls" in args:
                        return "lo"
                    return "\n".join(lab.PG_LIMITS.values())
                return ""

            def inspect(deadline, kind, ref):
                if kind == "volume":
                    return {"CreatedAt": "known", "Mountpoint": str(root / ref)}
                if "name" not in state:
                    return None
                return {
                    "Id": CID,
                    "Name": "/" + state["name"],
                    "Config": {"Labels": {lab.LABEL: state["run"]}},
                    "State": {"Status": "running", "OOMKilled": False},
                }

            context = MagicMock()
            watcher = context.Process.return_value
            watcher.pid, watcher.exitcode = 1, watchdog_exit
            watcher.is_alive.side_effect = lambda: not state.get("joined", False)
            watcher.join.side_effect = lambda timeout: state.update(joined=True)
            mocks = [
                (lab, "ROOT", root),
                (lab.multiprocessing, "get_context", MagicMock(return_value=context)),
                (lab.base, "save", MagicMock(side_effect=portable_save)),
                (lab.base, "snapshot", MagicMock(return_value={"volume": {"foreign"}})),
                (lab.base, "inspect", MagicMock(side_effect=inspect)),
                (lab, "checked", MagicMock(side_effect=checked)),
                (lab, "validate_image", MagicMock(return_value="sha256:" + CID)),
                (
                    lab,
                    "volume_source",
                    MagicMock(side_effect=lambda item, *args: Path(item["Mountpoint"])),
                ),
                (
                    lab,
                    "seed_volume",
                    MagicMock(
                        side_effect=lambda path, token, pg: tokens.update({path: token})
                    ),
                ),
                (
                    lab,
                    "sentinel_hash",
                    MagicMock(
                        side_effect=lambda path: lab.hashlib.sha256(
                            tokens[path].encode()
                        ).hexdigest()
                    ),
                ),
                (lab, "mem_available", MagicMock(return_value=1024**3)),
                (lab, "validate_container", MagicMock()),
                (lab, "ready", MagicMock()),
                (
                    lab,
                    "verify_database",
                    MagicMock(return_value={"database": "synthetic"}),
                ),
                (lab, "cleanup", MagicMock()),
            ]
            for target, name, value in mocks:
                stack.enter_context(patch.object(target, name, value))
            result = lab.run({})
            lab.cleanup.assert_called_once()
            return result

    def test_normal_mock_lifecycle_and_partial_create_timeouts(self):
        result = self.fake_run()
        self.assertEqual(result["status"], "E0B_RUNTIME_PASS")
        self.assertEqual(result["cleanup"], "CONFIRMED")
        for phase in (
            "volume.create",
            "container.create",
            "container.start",
            "container.exec",
        ):
            with self.subTest(phase=phase):
                result = self.fake_run(phase)
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(result["cleanup"], "CONFIRMED")
                self.assertEqual(result["foreign_inventory"], "PRESERVED")
        result = self.fake_run(watchdog_exit=1)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["cleanup"], "CONFIRMED")

    def test_watchdog_empty_or_excess_du_aborts_exact_owned_writer(self):
        name = "wb-lab-01-e0b-" + RUN
        item = {
            "Id": CID,
            "Name": "/" + name,
            "Config": {"Labels": {lab.LABEL: RUN}},
            "State": {"Status": "running", "OOMKilled": False},
        }
        volume = {
            "Name": name + "-pg",
            "Labels": {lab.LABEL: RUN},
            "Driver": "local",
            "Scope": "local",
            "Options": {},
            "CreatedAt": "known",
            "Mountpoint": "/owned",
        }
        ledger = {
            "run_id": RUN,
            "name": name,
            "container_id": CID,
            "volumes": {
                "pg": {
                    "name": name + "-pg",
                    "identity": {"CreatedAt": "known", "Mountpoint": "/owned"},
                }
            },
        }
        for output in ("", str(129 * 1024**2) + " /owned"):
            stop = MagicMock()
            stop.is_set.return_value = False
            with (
                patch.object(lab, "mem_available", return_value=1024**3),
                patch.object(
                    lab.shutil,
                    "disk_usage",
                    return_value=SimpleNamespace(free=8 * 1024**3),
                ),
                patch.object(
                    lab.base, "inspect", side_effect=[item, volume, item, None]
                ),
                patch.object(
                    lab.subprocess, "run", return_value=SimpleNamespace(stdout=output)
                ),
                patch.object(lab.base, "checked") as remove,
                self.assertRaises(SystemExit) as exit,
            ):
                lab.guard(lab.time.monotonic() + 30, ledger, stop, MagicMock())
            self.assertEqual(exit.exception.code, 1)
            self.assertEqual(
                remove.call_args.args[1:], ("container", "rm", "--force", CID)
            )


if __name__ == "__main__":
    unittest.main()
