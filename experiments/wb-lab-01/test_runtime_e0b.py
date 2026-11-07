"""Offline E0b acceptance: fake CLI only, never creates Docker/PG resources."""

import json
import os
import stat
import subprocess
import sys
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
            "Config": {"Volumes": {"/var/lib/postgresql": {}}},
        }
        self.assertEqual(lab.validate_image(item), "sha256:" + CID)
        for change in (
            {"Os": "windows"},
            {"Architecture": "amd64"},
            {"RepoDigests": [lab.IMAGE.replace("library", "attacker")]},
            {"RepoDigests": ["postgres@sha256:" + "0" * 64]},
            {"Config": {}},
            {"Config": None},
            {"Config": {"Volumes": ["/var/lib/postgresql"]}},
            {"Config": {"Volumes": {"/var/lib/postgresql/data": {}}}},
            {"Config": {"Volumes": {"/var/lib/postgresql": {}, "/untracked": {}}}},
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

    @unittest.skipUnless(
        sys.platform == "linux" and os.geteuid() == 0, "Linux UID switch requires root"
    )
    def test_sentinel_umask_and_uid_999(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o711)
            pg, media = root / "pg", root / "media"
            for path in (pg, media):
                path.mkdir()
                path.chmod(0o755)
            subprocess.run(
                [
                    sys.executable,
                    "-B",
                    "-c",
                    (
                        "import os, sys\nfrom pathlib import Path\nfrom runtime_e0b import seed_volume\n"
                        "old = os.umask(0o077)\ntry:\n"
                        "    seed_volume(Path(sys.argv[1]), 'p' * 64, True)\n"
                        "    seed_volume(Path(sys.argv[2]), 'm' * 64, False)\n"
                        "finally:\n    os.umask(old)\n"
                    ),
                    str(pg),
                    str(media),
                ],
                cwd=Path(lab.__file__).parent,
                check=True,
                timeout=5,
            )
            files = [path / "e0b.sentinel" for path in (pg, media)]
            for file in files:
                info = file.stat()
                self.assertEqual(info.st_uid, 0)
                self.assertTrue(stat.S_ISREG(info.st_mode))
                self.assertEqual(stat.S_IMODE(info.st_mode), 0o444)
            reader = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-B",
                    "-c",
                    (
                        "import hashlib, os, sys\nfrom pathlib import Path\n"
                        "assert (os.geteuid(), os.getegid(), os.getgroups()) == (999, 999, [])\n"
                        "for file in sys.argv[1:]:\n"
                        "    print(hashlib.sha256(Path(file).read_bytes()).hexdigest())\n"
                    ),
                    *map(str, files),
                ],
                user=999,
                group=999,
                extra_groups=[],
                capture_output=True,
                text=True,
                check=True,
                timeout=5,
            )
            expected = [
                lab.hashlib.sha256(byte * 64).hexdigest() for byte in (b"p", b"m")
            ]
            self.assertEqual(reader.stdout.splitlines(), expected)
            self.assertEqual([lab.sentinel_hash(p) for p in (pg, media)], expected)

    @unittest.skipUnless(sys.platform == "linux", "Linux directory-fd semantics")
    def test_seed_refuses_file_or_symlink_even_after_empty_check(self):
        for symlink in (False, True):
            with (
                self.subTest(symlink=symlink),
                tempfile.TemporaryDirectory() as directory,
            ):
                root = Path(directory)
                volume = root / "volume"
                volume.mkdir()
                sentinel = volume / "e0b.sentinel"
                foreign = root / "foreign" if symlink else sentinel
                foreign.write_bytes(b"foreign")
                if symlink:
                    sentinel.symlink_to(foreign)
                before = foreign.stat()
                with (
                    patch.object(lab.os, "listdir", return_value=[]),
                    self.assertRaises(FileExistsError),
                ):
                    lab.seed_volume(volume, "x" * 64, False)
                self.assertEqual(foreign.read_bytes(), b"foreign")
                self.assertEqual(foreign.stat().st_mode, before.st_mode)
                self.assertEqual(foreign.stat().st_ino, before.st_ino)
                self.assertEqual(sentinel.is_symlink(), symlink)

    @unittest.skipUnless(sys.platform == "linux", "Linux directory-fd semantics")
    def test_seed_stops_before_write_on_fchmod_or_fstat_failure(self):
        for operation, fault, expected in (
            ("fchmod", {"side_effect": OSError("chmod failed")}, OSError),
            ("fstat", {"side_effect": OSError("stat failed")}, OSError),
            (
                "fstat",
                {"return_value": SimpleNamespace(st_mode=stat.S_IFREG | 0o400)},
                lab.Blocked,
            ),
            (
                "fstat",
                {"return_value": SimpleNamespace(st_mode=stat.S_IFDIR | 0o444)},
                lab.Blocked,
            ),
        ):
            with (
                self.subTest(operation=operation, fault=fault),
                tempfile.TemporaryDirectory() as directory,
            ):
                with (
                    patch.object(lab.os, operation, **fault),
                    patch.object(lab.os, "fsync") as sync,
                ):
                    with self.assertRaises(expected):
                        lab.seed_volume(Path(directory), "x" * 64, False)
                    sync.assert_not_called()
                self.assertEqual((Path(directory) / "e0b.sentinel").read_bytes(), b"")

    def test_mounted_sentinel_command_failure_has_safe_reason(self):
        with (
            patch.object(
                lab,
                "cli",
                return_value=SimpleNamespace(
                    returncode=1, stdout="private-output", stderr="private-error"
                ),
            ),
            self.assertRaisesRegex(lab.Blocked, "^E0B_MOUNTED_SENTINEL_READ_FAILED$"),
        ):
            lab.checked(
                30,
                [],
                "container",
                "exec",
                CID,
                "sha256sum",
                failure="E0B_MOUNTED_SENTINEL_READ_FAILED",
            )

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

    def fake_run(
        self,
        failure=None,
        watchdog_exit=0,
        seed_failure=None,
        phase="e0b",
        scenario=None,
    ):
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
                    state["run"] = state["name"].rsplit("-", 1)[1]
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
                        side_effect=seed_failure
                        or (lambda path, token, pg: tokens.update({path: token}))
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
            result = lab.run({}, phase=phase, scenario=scenario)
            lab.cleanup.assert_called_once()
            return result

    def test_e2_scenario_failure_preserves_progress_and_reaches_cleanup(self):
        def failed(deadline, ledger, evidence):
            evidence["scenario"] = {"trials": [{"case": "synthetic_completed"}]}
            raise lab.Blocked("E2_QUERY_FAILED")

        result = self.fake_run(phase="e2", scenario=failed)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["cleanup"], "CONFIRMED")
        self.assertEqual(result["reason"], "E2_QUERY_FAILED")
        self.assertEqual(len(result["scenario"]["trials"]), 1)
        self.assertEqual(result["E3_to_E5"], "NOT_RUN")
        self.assertTrue(result["ledger"]["name"].startswith("wb-lab-01-e2-"))

    def test_seed_failure_blocks_container_creation_and_reaches_cleanup(self):
        for error in (
            OSError("descriptor error"),
            lab.Blocked("E0B_SENTINEL_MODE_OR_TYPE"),
        ):
            result = self.fake_run(seed_failure=error)
            self.assertEqual(result["status"], "BLOCKED")
            self.assertEqual(result["cleanup"], "CONFIRMED")
            self.assertFalse(result["ledger"]["container_create_requested"])
            self.assertTrue(result["ledger"]["volumes"]["pg"]["requested"])
            self.assertFalse(result["ledger"]["volumes"]["media"]["requested"])

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
