"""E4a RO mount and sanitized failure-diagnostic regressions."""

import errno
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

import e4_probe as probe
import runtime_e0a as base
import runtime_e1 as runner
import runtime_e4a as retry
import runtime_e34 as combined
from preflight import Blocked


def cleanup_fixture(name, run_id, requested, cid, volume_requested, volume):
    ledger = {
        "name": name,
        "run_id": run_id,
        "container_create_requested": requested,
        "volume_create_requested": volume_requested,
    }
    if cid:
        ledger["container_id"] = cid
    if volume:
        ledger["volume"] = {key: volume[key] for key in ("CreatedAt", "Mountpoint")}
    base.cleanup(time.monotonic() + 10, ledger)


class FixTests(unittest.TestCase):
    def test_rw_is_blocked_before_validation_or_probe(self):
        item = {"Mounts": [{"RW": True}]}
        with (
            patch.object(runner, "validate_container") as validate,
            patch.object(runner, "start_e4a") as start,
            self.assertRaisesRegex(Blocked, "E4A_MEDIA_NOT_READ_ONLY"),
        ):
            runner.validate_controller_mount(item, "image", "name", "source", "e4a")
        validate.assert_not_called()
        start.assert_not_called()

    def test_ro_response_is_validated_without_modification_and_e1_stays_rw(self):
        for phase, rw in (("e4a", False), ("e1", True)):
            item = {"Mounts": [{"RW": rw}]}
            with patch.object(runner, "validate_container") as validate:
                runner.validate_controller_mount(item, "image", "name", "source", phase)
            if phase == "e4a":
                self.assertIs(validate.call_args.args[0], item)
            self.assertEqual(item["Mounts"][0]["RW"], rw)

    def test_sanitized_nonzero_result_and_malformed_output(self):
        secret = "do-not-retain-output"
        payloads = [
            json.dumps(
                {
                    "probe_status": "FAILED",
                    "code": "MEDIA_NOT_READ_ONLY",
                    "stage": "namespace",
                }
            ),
            secret,
            "[]",
            json.dumps(
                {"probe_status": "FAILED", "code": secret, "stage": "namespace"}
            ),
        ]
        for stdout in payloads:
            evidence = {}
            with (
                patch.object(
                    runner,
                    "command",
                    return_value=SimpleNamespace(
                        returncode=73, stdout=stdout, stderr=secret
                    ),
                ),
                self.assertRaisesRegex(Blocked, "E4A_START_OR_PROBE_NONZERO"),
            ):
                runner.start_e4a(time.monotonic() + 1, "id", "name", "run", evidence)
            self.assertNotIn(secret, json.dumps(evidence))
            self.assertEqual(evidence["start_diagnostic"]["cli_returncode"], 73)
            self.assertEqual("probe_failure" in evidence, stdout == payloads[0])

    def test_diagnostic_categories_do_not_equate_exit_137_with_oom(self):
        cases = [
            ({"container_state": {"oom_killed": True}}, "OOM_RESOURCE_FAILURE"),
            ({"failure_operation": {"error_type": "TimeoutExpired"}}, "DOCKER_TIMEOUT"),
            ({"watchdog_failure": {"operation": "stop"}}, "WATCHDOG_FAILURE"),
            (
                {"container_state": {"status": "created", "has_engine_error": True}},
                "DOCKER_START_FAILURE",
            ),
            (
                {"probe_failure": {"code": "MEDIA_NOT_READ_ONLY"}},
                "PYTHON_PROBE_FAILURE",
            ),
            ({"probe_failure": {"code": "RESOURCE_ERROR"}}, "PROBE_RESOURCE_FAILURE"),
            (
                {"container_state": {"status": "exited", "exit_code": 137}},
                "CONTAINER_NONZERO_ROOT_CAUSE_NOT_PROVEN",
            ),
        ]
        for detail, expected in cases:
            evidence = {"status": "BLOCKED", **detail}
            runner.classify_e4a(evidence)
            self.assertEqual(evidence["diagnostic_category"], expected)

    def test_state_error_is_hashed_and_fields_are_allowlisted(self):
        ledger = {"container_id": "a" * 64, "name": "owned", "run_id": "b" * 32}
        state = {
            "Status": "exited",
            "ExitCode": 73,
            "OOMKilled": False,
            "Error": "private-string",
            "extra": "private-string",
        }
        item = {"State": state}
        evidence = {}
        with (
            patch.object(runner, "inspect", return_value=item),
            patch.object(runner, "owned_container", return_value=item),
        ):
            runner.observe_e4a(0, ledger, evidence)
        self.assertNotIn("private-string", json.dumps(evidence))
        self.assertEqual(evidence["container_state"]["exit_code"], 73)

    def test_unknown_exception_message_cannot_enter_probe_diagnostic(self):
        self.assertEqual(
            probe.failure_code(RuntimeError("private-string")), "UNEXPECTED_EXCEPTION"
        )
        self.assertEqual(
            probe.failure_code(OSError(errno.ENOMEM, "private-string")),
            "RESOURCE_ERROR",
        )
        self.assertEqual(probe.failure_code(TimeoutError()), "PROBE_TIMEOUT")

    def test_retry_and_retired_combined_never_start_postgres(self):
        with (
            patch.object(sys, "argv", ["runtime_e4a.py"]),
            patch.object(retry, "collect") as collect,
            self.assertRaisesRegex(Blocked, "OWNER_E4A_ONLY_RUNTIME_APPROVAL_REQUIRED"),
        ):
            retry.main()
        collect.assert_not_called()
        with (
            patch.object(sys, "argv", ["runtime_e34.py", combined.APPROVAL]),
            patch.object(combined.pg, "run") as pg,
            self.assertRaisesRegex(Blocked, "COMBINED_E3_E4A_RETIRED"),
        ):
            combined.main()
        pg.assert_not_called()

    def test_lost_volume_create_response_is_reconciled_by_exact_ownership(self):
        run_id = "a" * 32
        item = {
            "Name": "owned",
            "Labels": {base.LABEL: run_id},
            "Driver": "local",
            "Scope": "local",
            "Options": {},
            "CreatedAt": "known",
            "Mountpoint": "/synthetic/owned",
        }
        with (
            patch.object(base, "inspect", side_effect=[item, None]),
            patch.object(base, "checked", return_value="") as checked,
        ):
            cleanup_fixture("owned", run_id, False, None, True, None)
        self.assertEqual(checked.call_args.args[1:], ("volume", "rm", "owned"))
        item["Labels"] = {base.LABEL: "foreign"}
        with (
            patch.object(base, "inspect", return_value=item),
            patch.object(base, "checked") as checked,
            self.assertRaisesRegex(Blocked, "VOLUME_OWNERSHIP"),
        ):
            cleanup_fixture("owned", run_id, False, None, True, None)
        checked.assert_not_called()

    def test_history_ledger_uses_only_authenticated_bytes_and_rejects_remaining_resources(
        self,
    ):
        run_id = "a" * 32
        ledger = {
            "run_id": run_id,
            "name": "owned",
            "container_id": "b" * 64,
            "volume_create_requested": True,
        }
        raw = json.dumps({"cleanup": "CONFIRMED", "ledger": ledger}).encode()
        for kind in ("absent", "container", "volume"):
            inventory = {"container": set(), "volume": set(), "network": set()}
            if kind == "container":
                inventory[kind].add(ledger["container_id"])
            elif kind == "volume":
                inventory[kind].add("owned")
            with (
                patch.object(retry, "RETAINED", {run_id: "fixed"}),
                patch.object(retry.e2, "retained_evidence", return_value={run_id: raw}),
                patch.object(retry.base, "snapshot", return_value=inventory),
                patch.object(retry.base, "inspect", return_value=None),
                patch.object(
                    Path,
                    "read_text",
                    side_effect=AssertionError("unauthenticated re-open"),
                ),
            ):
                if kind == "absent":
                    retry.verify_history(0)
                else:
                    with self.assertRaises(Blocked):
                        retry.verify_history(0)

    @unittest.skipUnless(
        sys.platform == "linux" and os.geteuid() == 0, "root nofollow file fixture"
    )
    def test_replacement_after_hash_does_not_change_parsed_ledger(self):
        run_id = "a" * 32
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run = root / run_id
            run.mkdir(mode=0o700)
            file = run / "evidence.json"
            raw = json.dumps(
                {"cleanup": "CONFIRMED", "ledger": {"run_id": run_id, "name": "owned"}}
            ).encode()
            file.write_bytes(raw)
            file.chmod(0o600)
            outside = root / "replacement"
            outside.write_text("invalid replacement")

            def snapshot(deadline):
                file.unlink()
                file.symlink_to(outside)
                return {"container": set(), "volume": set(), "network": set()}

            with (
                patch.object(retry, "ROOT", root),
                patch.object(
                    retry, "RETAINED", {run_id: hashlib.sha256(raw).hexdigest()}
                ),
                patch.object(retry.base, "snapshot", side_effect=snapshot),
                patch.object(retry.base, "inspect", return_value=None),
            ):
                retry.verify_history(0)
            self.assertTrue(file.is_symlink())


@unittest.skipUnless(
    os.environ.get("WB_E4A_REAL_DOCKER") == "1",
    "explicit local disposable Docker fixture",
)
class LocalDocker(unittest.TestCase):
    def test_real_named_volume_read_only_and_negative_rw(self):
        docker = ["docker", "--host", "unix:///var/run/docker.sock"]
        image = "docker.io/library/python@sha256:f21c0d5a44c56805654c15abccc1b2fd576c8d93aca0a3f74b4aba2dc92510e2"

        def cli(*args):
            return subprocess.check_output(
                docker + list(args), text=True, timeout=12
            ).strip()

        before = {
            k: set(cli(k, "ls", *flags).splitlines())
            for k, flags in (
                ("container", ("-aq", "--no-trunc")),
                ("volume", ("-q",)),
                ("network", ("-q", "--no-trunc")),
            )
        }
        for readonly, inject_failure in ((False, False), (True, False), (True, True)):
            run_id = uuid.uuid4().hex
            name = "wb-e4a-fix-local-" + run_id
            cid = None
            volume_requested = False
            volume = None
            requested = False
            try:
                volume_requested = True
                self.assertEqual(
                    cli("volume", "create", "--label", f"{base.LABEL}={run_id}", name),
                    name,
                )
                [volume] = json.loads(cli("volume", "inspect", name))
                base.owned_volume(volume, name, run_id)
                source = (
                    Path(__file__).with_name("lab_metrics.py").read_text()
                    + "\n"
                    + Path(__file__).with_name("e4_probe.py").read_text()
                )
                code = (
                    "import json,os,sys; e=json.loads(sys.argv[1]); d=os.stat('/media').st_dev; e['device']=f'{os.major(d)}:{os.minor(d)}'; sys.argv[1]=json.dumps(e); exec("
                    + repr(source)
                    + ")"
                )
                expected = {"uid": 65532, "interfaces": ["lo"], "limits": base.LIMITS}
                if inject_failure:
                    expected["uid"] = 0
                requested = True
                cid = cli(
                    "container",
                    "create",
                    "--pull=never",
                    "--name",
                    name,
                    "--label",
                    f"{base.LABEL}={run_id}",
                    "--network=none",
                    "--ipc=private",
                    "--cgroupns=private",
                    "--read-only",
                    "--cap-drop=ALL",
                    "--security-opt=no-new-privileges",
                    "--log-driver=none",
                    "--memory=64m",
                    "--memory-swap=64m",
                    "--cpus=.25",
                    "--pids-limit=16",
                    "--user=65532:65532",
                    "--mount",
                    f"type=volume,source={name},target=/media,volume-nocopy"
                    + (",readonly" if readonly else ""),
                    image,
                    "python",
                    "-I",
                    "-B",
                    "-c",
                    code,
                    json.dumps(expected),
                )
                [item] = json.loads(cli("container", "inspect", cid))
                base.owned_container(item, name, run_id, cid)
                if not readonly:
                    with self.assertRaisesRegex(Blocked, "E4A_MEDIA_NOT_READ_ONLY"):
                        runner.validate_controller_mount(
                            item, item["Image"], name, volume["Mountpoint"], "e4a"
                        )
                    self.assertEqual(item["State"]["Status"], "created")
                else:
                    runner.validate_controller_mount(
                        item, item["Image"], name, volume["Mountpoint"], "e4a"
                    )
                    evidence = {}
                    if inject_failure:
                        with self.assertRaisesRegex(
                            Blocked, "E4A_START_OR_PROBE_NONZERO"
                        ):
                            runner.start_e4a(
                                time.monotonic() + 12, cid, name, run_id, evidence
                            )
                        runner.observe_e4a(
                            time.monotonic() + 3,
                            {"container_id": cid, "name": name, "run_id": run_id},
                            evidence,
                        )
                        evidence["status"] = "BLOCKED"
                        runner.classify_e4a(evidence)
                        self.assertEqual(
                            evidence["probe_failure"],
                            {
                                "code": "ACTUAL_CONTROLLER_ISOLATION",
                                "stage": "isolation",
                            },
                        )
                        self.assertEqual(evidence["container_state"]["exit_code"], 73)
                        self.assertEqual(
                            evidence["diagnostic_category"], "PYTHON_PROBE_FAILURE"
                        )
                        print(
                            "E4A_FAILURE_ACCEPTANCE "
                            + json.dumps(evidence, sort_keys=True)
                        )
                    else:
                        result = json.loads(
                            runner.start_e4a(
                                time.monotonic() + 12, cid, name, run_id, evidence
                            )
                        )
                        combined.e4_validate(result, result["device"])
                        runner.observe_e4a(
                            time.monotonic() + 3,
                            {"container_id": cid, "name": name, "run_id": run_id},
                            evidence,
                        )
                        self.assertFalse(evidence["container_state"]["oom_killed"])
                        self.assertEqual(evidence["container_state"]["exit_code"], 0)
                        print(
                            "E4A_RO_ACCEPTANCE "
                            + json.dumps(
                                {"probe": result, "diagnostic": evidence},
                                sort_keys=True,
                            )
                        )
            finally:
                cleanup_fixture(name, run_id, requested, cid, volume_requested, volume)
        after = {
            k: set(cli(k, "ls", *flags).splitlines())
            for k, flags in (
                ("container", ("-aq", "--no-trunc")),
                ("volume", ("-q",)),
                ("network", ("-q", "--no-trunc")),
            )
        }
        self.assertTrue(
            all(before[k] <= after[k] for k in before), "foreign inventory changed"
        )
