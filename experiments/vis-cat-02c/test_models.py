import copy
import threading
import unittest

from model import InjectedCrash, LabModel, Rejected
from preflight import (
    LABEL,
    ApprovedHost,
    GateRejected,
    verify_decoder,
    verify_host,
    verify_initialization,
    verify_inventory,
)

RUN = "a" * 32


def fixture():
    ledger = [
        {
            "role": role,
            "id": f"id-{role}",
            "name": f"vis-cat-02c-{RUN}-{role}",
            "created": True,
            "absent_before_create": True,
        }
        for role in ("media", "pgdata", "controller", "postgres", "network")
    ]
    inventory = {}
    for entry in ledger:
        role = entry["role"]
        resource = {"id": entry["id"], "name": entry["name"], "labels": {LABEL: RUN}}
        if role in {"media", "pgdata"}:
            resource.update(driver="local", options={})
        elif role == "network":
            resource["internal"] = True
        else:
            controller = role == "controller"
            resource.update(
                image="sha256:" + "b" * 64,
                privileged=False,
                read_only=True,
                cap_drop=["ALL"],
                no_new_privileges=True,
                ports=[],
                pid_mode="",
                ipc_mode="private",
                networks=["id-network"],
                mounts=[("id-media", "/media")]
                if controller
                else [("id-pgdata", "/var/lib/postgresql")],
                memory=(256 if controller else 512) * 1024**2,
                memory_swap=(256 if controller else 512) * 1024**2,
                user="65534:65534" if controller else "999:999",
                pids=64,
                nano_cpus=1_000_000_000,
            )
        inventory[entry["id"]] = resource
    return ledger, inventory


class PreflightTests(unittest.TestCase):
    def test_owned_inventory(self):
        ledger, inventory = fixture()
        self.assertEqual(
            verify_inventory(RUN, ledger, inventory, {"ops-id"})["gate"], "E0a"
        )

    def test_rejects_foreign_ids_mounts_networks_and_privileges(self):
        for field, value in (
            ("mounts", [("ops-id", "/media")]),
            ("privileged", True),
            ("ports", [3001]),
            ("networks", ["ops-network"]),
            ("pid_mode", "host"),
            ("ipc_mode", "host"),
            ("ports", [3001]),
            ("user", "0:0"),
            ("memory_swap", 2**40),
            ("pid_mode", "host"),
            ("labels", {LABEL: "foreign"}),
            ("cap_drop", []),
        ):
            with self.subTest(field=field):
                ledger, inventory = fixture()
                inventory["id-controller"][field] = value
                with self.assertRaises(GateRejected):
                    verify_inventory(RUN, ledger, inventory, {"ops-id"})

    def test_existing_or_duplicate_resource_refused(self):
        for defect in ("existing", "duplicate", "forbidden"):
            with self.subTest(defect=defect):
                ledger, inventory = fixture()
                if defect == "existing":
                    ledger[0]["absent_before_create"] = False
                elif defect == "duplicate":
                    ledger[0]["id"] = ledger[1]["id"]
                with self.assertRaises(GateRejected):
                    verify_inventory(
                        RUN,
                        ledger,
                        inventory,
                        {"id-media"} if defect == "forbidden" else set(),
                    )

    def test_host_requires_approved_context_device_and_ext4(self):
        approved = ApprovedHost("isolated-test", "daemon-1", "device-1", "6.1-test")
        host = {
            "context": "isolated-test",
            "daemon_id": "daemon-1",
            "kernel": "6.1-test",
            "filesystem": "ext4",
            "device_uuid": "device-1",
            "device_bytes": 4 * 1024**3,
            "free_bytes": 2 * 1024**3,
            "stage_device": 1,
            "final_device": 1,
            "mount_options": ["rw", "relatime", "data=ordered"],
        }
        verify_host(host, approved)
        for field, value in (
            ("filesystem", "overlayfs"),
            ("context", "desktop-linux"),
            ("device_uuid", "ops-device"),
            ("free_bytes", 0),
            ("final_device", 2),
            ("mount_options", ["rw", "nobarrier"]),
        ):
            with self.subTest(field=field), self.assertRaises(GateRejected):
                verify_host({**host, field: value}, approved)

    def test_initialization_requires_exact_sentinels_and_disposable_database(self):
        observed = {
            "media_sentinel": "c" * 64,
            "db_sentinel": "d" * 64,
            "database": "vis_cat_02c_" + RUN,
            "tables": ["lab_sentinel", "lab_intent", "lab_reference"],
            "superuser": False,
            "createdb": False,
            "createrole": False,
        }
        self.assertEqual(
            verify_initialization(RUN, "c" * 64, "d" * 64, observed)["gate"], "E0b"
        )
        for field, value in (
            ("media_sentinel", "wrong"),
            ("database", "stdu_shop"),
            ("tables", ["staff_user"]),
            ("createdb", True),
        ):
            with self.subTest(field=field), self.assertRaises(GateRejected):
                verify_initialization(
                    RUN, "c" * 64, "d" * 64, {**observed, field: value}
                )

    def test_decoder_requires_no_network_or_mounts(self):
        container = {
            "pid_mode": "",
            "ipc_mode": "private",
            "ports": [],
            "network_mode": "none",
            "networks": [],
            "mounts": [],
            "credential_env": [],
            "user": "65533:65533",
            "privileged": False,
            "read_only": True,
            "cap_drop": ["ALL"],
            "no_new_privileges": True,
            "memory": 256 * 1024**2,
            "memory_swap": 256 * 1024**2,
            "pids": 32,
            "nano_cpus": 1_000_000_000,
        }
        self.assertTrue(verify_decoder(container, "65533:65533"))
        for field, value in (
            ("networks", ["ops-network"]),
            ("pid_mode", "host"),
            ("ipc_mode", "host"),
            ("ports", [3001]),
            ("credential_env", ["DB_URL"]),
            ("mounts", [("private", "/data/files")]),
            ("user", "0:0"),
        ):
            with self.subTest(field=field), self.assertRaises(GateRejected):
                verify_decoder({**container, field: value}, "65533:65533")


class ProtocolTests(unittest.TestCase):
    def model(self):
        model = LabModel()
        model.disk.files["foreign.stage"] = b"other intent"
        model.disk.files["registered.final"] = b"existing reference"
        model.create("source", b"synthetic original")
        return model

    def test_publish_and_exact_retry_preserve_history(self):
        model = self.model()
        model.materialize("source", 1, b"synthetic original")
        first = model.commit("source", 1)
        before = copy.deepcopy(model.history)
        self.assertEqual(model.commit("source", 1), first)
        self.assertEqual(model.history, before)
        self.assertEqual(model.validate_reference("source"), b"synthetic original")

    def test_crashes_before_commit_are_reconciled_only_after_fence_and_quiescence(self):
        for point in (
            "before-write",
            "after-write",
            "after-stage-sync",
            "after-promote",
            "after-final-sync",
        ):
            with self.subTest(point=point):
                model = self.model()
                with self.assertRaises(InjectedCrash):
                    model.materialize("source", 1, b"synthetic original", point)
                model.fence("source", 1)
                with self.assertRaisesRegex(Rejected, "QUIESCENCE"):
                    model.reconcile("source", 1, set())
                model.reconcile("source", 1, {("source", 1)})
                model.reconcile("source", 1, {("source", 1)})
                self.assertFalse(model.references)
                self.assertEqual(
                    model.disk.files,
                    {
                        "foreign.stage": b"other intent",
                        "registered.final": b"existing reference",
                    },
                )
                with self.assertRaisesRegex(Rejected, "STALE"):
                    model.materialize("source", 1, b"synthetic original")

    def test_crash_before_and_after_commit(self):
        for point in ("before-commit", "after-commit"):
            with self.subTest(point=point):
                model = self.model()
                model.materialize("source", 1, b"synthetic original")
                with self.assertRaises(InjectedCrash):
                    model.commit("source", 1, point)
                self.assertEqual(bool(model.references), point == "after-commit")
                model.commit("source", 1)
                self.assertNotIn(model.paths("source", 1)[0], model.disk.files)
                self.assertEqual(
                    model.validate_reference("source"), b"synthetic original"
                )
                with self.assertRaises(Rejected):
                    model.fence("source", 1)

    def test_exclusive_stage_and_final_collision(self):
        model = self.model()
        stage, final = model.paths("source", 1)
        model.disk.stage(stage, b"synthetic original")
        with self.assertRaisesRegex(Rejected, "STAGE_EXISTS"):
            model.disk.stage(stage, b"overwrite")
        model.disk.sync(stage)
        model.disk.files[final] = b"existing final"
        with self.assertRaisesRegex(Rejected, "PROMOTION_REFUSED"):
            model.disk.promote(stage, final)
        self.assertEqual(model.disk.files[final], b"existing final")

    def test_bad_bytes_missing_final_and_database_failure_deny_commit(self):
        for defect in ("hash", "missing", "database"):
            with self.subTest(defect=defect):
                model = self.model()
                final = model.materialize("source", 1, b"synthetic original")
                if defect == "hash":
                    model.disk.files[final] = b"wrong bytes"
                elif defect == "missing":
                    del model.disk.files[final]
                else:
                    model.database_available = False
                with self.assertRaises(Rejected):
                    model.commit("source", 1)
                self.assertFalse(model.references)

    def test_expiry_at_decision_blocks_commit(self):
        model = self.model()
        model.materialize("source", 1, b"synthetic original")
        model.now = 240
        with self.assertRaisesRegex(Rejected, "LEASE_EXPIRED"):
            model.commit("source", 1)

    def test_external_corruption_is_detected_without_rewriting_reference(self):
        model = self.model()
        model.materialize("source", 1, b"synthetic original")
        final = model.commit("source", 1)
        model.disk.files[final] = b"corruption"
        with self.assertRaisesRegex(Rejected, "EXTERNAL_CORRUPTION"):
            model.validate_reference("source")
        self.assertEqual(model.references["source"], final)

    def test_ordered_competing_commit_and_fence(self):
        for first in ("commit", "fence"):
            with self.subTest(first=first):
                model = self.model()
                model.materialize("source", 1, b"synthetic original")
                release_second = threading.Event()
                result = []
                errors = []

                def operation(
                    name,
                    waits,
                    release_second=release_second,
                    model=model,
                    result=result,
                    errors=errors,
                ):
                    try:
                        if waits and not release_second.wait(1):
                            raise TimeoutError("barrier")
                        try:
                            getattr(model, name)("source", 1)
                            result.append(name)
                        except Rejected:
                            result.append(name + "-denied")
                    except (RuntimeError, AssertionError) as error:
                        errors.append(error)
                    finally:
                        if not waits:
                            release_second.set()

                second = "fence" if first == "commit" else "commit"
                threads = [
                    threading.Thread(target=operation, args=(first, False)),
                    threading.Thread(target=operation, args=(second, True)),
                ]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(2)
                    self.assertFalse(thread.is_alive())
                self.assertFalse(errors)
                self.assertEqual(result, [first, second + "-denied"])


if __name__ == "__main__":
    unittest.main()
