"""One bounded E1 series on the approved WB lab using the E0a controller profile."""

import hashlib
import json
import multiprocessing
import os
import shutil
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

from e1_probe import CANARY, CASES, PAYLOAD
from preflight import (
    LABEL,
    ROOT,
    Blocked,
    collect,
    engine_info,
    mem_available,
    mount,
    require,
    thresholds,
)
from runtime_e0a import (
    DAEMON,
    HEX_ID,
    IMAGE,
    LIMITS,
    PHASE,
    TRACE,
    checked,
    cleanup,
    inspect,
    owned_container,
    owned_volume,
    save,
    snapshot,
    validate_container,
    validate_image,
    watchdog,
)

APPROVAL = "OWNER_E1_RUNTIME_APPROVED"
E0B_RUN = "0768c90d5d434eaea045682734e3ff85"
E0B_SHA = "cb5f9c40c4dadf4e470dd2610396847b63ce130db2bcd64721d09c14d4a23255"
ORDERS = (
    (
        "write",
        "file_fsync",
        "stage_fsync",
        "promote",
        "final_fsync",
        "stage_unlink",
        "stage_cleanup_fsync",
    ),
    ("exclusive_refused",),
    ("write", "file_fsync", "stage_fsync", "promotion_refused"),
)


def validate_result(probe, device):
    require(
        probe["limits"] == LIMITS
        and probe["interfaces"] == ["lo"]
        and probe["uid"] == 65532
        and probe["device"] == device,
        "E1_ACTUAL_ISOLATION",
    )
    for trial, case, order in zip(probe["trials"], CASES, ORDERS, strict=True):
        dev, inode = trial["identity"]
        require(
            trial["case"] == case
            and tuple(x["step"] for x in trial["trace"]) == order
            and inode > 0
            and f"{os.major(dev)}:{os.minor(dev)}" == device
            and trial["sha256"]
            == hashlib.sha256(PAYLOAD if case == "promotion" else CANARY).hexdigest(),
            "E1_TRIAL_EVIDENCE",
        )


def verify_volume_contents(deadline, ledger):
    name = ledger["name"]
    item = owned_volume(inspect(deadline, "volume", name), name, ledger["run_id"])
    require(
        all(item[k] == ledger["volume"][k] for k in ("CreatedAt", "Mountpoint")),
        "E1_VOLUME_CHANGED",
    )
    source = Path(item["Mountpoint"])
    require(source.resolve(strict=True) == source, "E1_VOLUME_PATH_CHANGED")
    source_meta = source.stat()
    allowed = {
        "stage": set(CASES),
        "final": {"promotion", "promotion_collision", "canary"},
    }
    for directory in source.iterdir():
        meta = directory.lstat()
        require(
            directory.name in allowed
            and stat.S_ISDIR(meta.st_mode)
            and meta.st_uid == 65532
            and meta.st_dev == source_meta.st_dev,
            "E1_UNKNOWN_DIRECTORY",
        )
        for file in directory.iterdir():
            meta = file.lstat()
            require(
                file.name in allowed[directory.name]
                and stat.S_ISREG(meta.st_mode)
                and meta.st_uid == 65532
                and meta.st_dev == source_meta.st_dev
                and meta.st_size <= len(PAYLOAD),
                "E1_UNKNOWN_FILE",
            )


def run_probe(
    host,
    *,
    phase="e1",
    probe_name="e1_probe.py",
    validator=validate_result,
    volume_validator=verify_volume_contents,
):
    require(
        (phase, probe_name) in {("e1", "e1_probe.py"), ("e4a", "e4_probe.py")},
        "LAB_CONTROLLER_PHASE",
    )
    run_id = uuid.uuid4().hex
    name = f"wb-lab-01-{phase}-" + run_id
    run_dir = ROOT / run_id
    run_dir.mkdir(mode=0o700)
    path = run_dir / "evidence.json"
    ledger = {
        "run_id": run_id,
        "name": name,
        "container_create_requested": False,
        "volume_create_requested": False,
    }
    evidence = {
        "status": "NOT_RUN",
        "e0b_evidence_sha256": E0B_SHA,
        "host_mount": host["mounts"]["root"],
        "ledger": ledger,
        "cleanup": "NOT_RUN",
        ("E2_to_E5" if phase == "e1" else "E5"): "NOT_RUN",
        "VDS_equivalence": "NOT_PROVEN",
    }
    trace = []
    trace_token = TRACE.set(trace)
    phase_token = PHASE.set("workload")
    evidence["operations"] = trace
    deadline = time.monotonic() + 30
    before = None
    watcher = None
    context = multiprocessing.get_context("fork")
    stop = context.Event()
    ready = context.Event()
    diagnostic_read, diagnostic_write = context.Pipe(duplex=False)
    try:
        before = snapshot(deadline)
        require(
            name not in before["volume"]
            and inspect(deadline, "container", name) is None,
            "RUN_NAME_COLLISION",
        )
        [image] = json.loads(checked(deadline, "image", "inspect", IMAGE))
        image_id = validate_image(image)
        require(not image["Config"].get("Volumes"), "E1_IMPLICIT_IMAGE_VOLUME")
        thresholds(mem_available(), shutil.disk_usage(ROOT).free)
        ledger["image_id"] = image_id
        ledger["volume_create_requested"] = True
        save(path, evidence)
        require(
            checked(
                deadline,
                "volume",
                "create",
                "--driver",
                "local",
                "--label",
                f"{LABEL}={run_id}",
                name,
            )
            == name,
            "VOLUME_CREATE_RESPONSE",
        )
        volume = owned_volume(inspect(deadline, "volume", name), name, run_id)
        ledger["volume"] = {key: volume[key] for key in ("CreatedAt", "Mountpoint")}
        source = Path(volume["Mountpoint"])
        expected = Path(host["docker_root"]) / "volumes" / name / "_data"
        require(
            source == expected
            and source.resolve(strict=True) == source
            and not any(source.iterdir()),
            "VOLUME_SOURCE",
        )
        require(source.stat().st_uid == 0, "E1_VOLUME_INITIAL_OWNER")
        observed = mount(source)
        device = host["mounts"]["root"]["maj:min"]
        require(
            observed["maj:min"] == device and observed["fstype"] == "ext4",
            "VOLUME_DEVICE",
        )
        evidence["volume_device"] = device
        require(
            device == "179:2"
            and observed["source"] == "/dev/mmcblk0p2"
            and observed["target"] == host["mounts"]["root"]["target"],
            "E1_DEVICE",
        )
        source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fchown(source_fd, 65532, 65532)
            os.fchmod(source_fd, 0o700)
            os.fsync(source_fd)
        finally:
            os.close(source_fd)
        thresholds(mem_available(), shutil.disk_usage(ROOT).free)
        ledger["container_create_requested"] = True
        save(path, evidence)
        container_id = checked(
            deadline,
            "container",
            "create",
            "--pull=never",
            "--name",
            name,
            "--label",
            f"{LABEL}={run_id}",
            "--network=none",
            "--ipc=private",
            "--cgroupns=private",
            "--read-only",
            "--user=65532:65532",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--log-driver=none",
            "--memory=64m",
            "--memory-swap=64m",
            "--cpus=0.25",
            "--pids-limit=16",
            "--mount",
            f"type=volume,source={name},target=/media,volume-nocopy",
            image_id,
            "python",
            "-I",
            "-B",
            "-c",
            (
                (Path(__file__).with_name("lab_metrics.py").read_text() + "\n")
                if phase == "e4a"
                else ""
            )
            + Path(__file__).with_name(probe_name).read_text(encoding="utf-8"),
            json.dumps(
                {"device": device, "uid": 65532, "interfaces": ["lo"], "limits": LIMITS}
            ),
        )
        require(HEX_ID.fullmatch(container_id), "CONTAINER_ID_FORMAT")
        ledger["container_id"] = container_id
        save(path, evidence)
        item = owned_container(
            inspect(deadline, "container", container_id), name, run_id, container_id
        )
        require(
            len(item["Mounts"]) == 1 and item["Mounts"][0]["RW"] is True,
            "E1_WRITABLE_MOUNT",
        )
        # Reuse the accepted checks for every other container property.
        normalized = {**item, "Mounts": [{**item["Mounts"][0], "RW": False}]}
        validate_container(normalized, image_id, name, str(source))
        watcher = context.Process(
            target=watchdog,
            args=(deadline, name, run_id, container_id, stop, ready, diagnostic_write),
        )
        watcher.start()
        require(ready.wait(4) and watcher.is_alive(), "WATCHDOG_NOT_READY")
        thresholds(mem_available(), shutil.disk_usage(ROOT).free)
        result = checked(deadline, "container", "start", "--attach", container_id)
        require(len(result) <= 8192, "PROBE_OUTPUT_BUDGET")
        probe = json.loads(result)
        validator(probe, device)
        evidence["observed"] = probe
        finished = owned_container(
            inspect(deadline, "container", container_id), name, run_id, container_id
        )
        require(
            finished["State"]["Status"] == "exited"
            and finished["State"]["ExitCode"] == 0
            and not finished["State"]["OOMKilled"],
            "PROBE_EXIT_UNCONFIRMED",
        )
        thresholds(mem_available(), shutil.disk_usage(ROOT).free)
        evidence["status"] = "PROBE_PASS"
    except (
        Blocked,
        OSError,
        KeyError,
        ValueError,
        TypeError,
        subprocess.TimeoutExpired,
        KeyboardInterrupt,
    ) as error:
        evidence["status"] = "BLOCKED"
        evidence["reason"] = (
            str(error) if isinstance(error, Blocked) else type(error).__name__
        )
    finally:
        evidence["failure_operation"] = next(
            (dict(row) for row in reversed(trace) if row["error_type"]), None
        )
        PHASE.set("cleanup")
        cleanup_deadline = time.monotonic() + 10
        stop.set()
        try:
            if watcher is not None and watcher.pid is not None:
                watcher.join(4)
                require(not watcher.is_alive(), "WATCHDOG_STOP_UNCONFIRMED")
                if watcher.exitcode != 0:
                    evidence["status"] = "BLOCKED"
                    evidence["reason"] = "WATCHDOG_STOP_CONDITION"
            if diagnostic_read.poll():
                evidence["watchdog_failure"] = diagnostic_read.recv()
            require(engine_info()["ID"] == DAEMON, "E1_DAEMON_CHANGED")
            writer = {**ledger, "volume_create_requested": False}
            try:
                cleanup(cleanup_deadline, writer)
            finally:
                if "container_id" in writer:
                    ledger["container_id"] = writer["container_id"]
            if ledger["volume_create_requested"]:
                require("volume" in ledger, "E1_VOLUME_CREATION_UNCONFIRMED")
                volume_validator(cleanup_deadline, ledger)
            cleanup(cleanup_deadline, {**ledger, "container_create_requested": False})
            evidence["cleanup"] = "CONFIRMED"
            if before is not None:
                after = snapshot(cleanup_deadline)
                require(
                    all(before[kind] <= after[kind] for kind in before),
                    "FOREIGN_INVENTORY_CHANGED",
                )
                evidence["foreign_inventory"] = "PRESERVED"
            if evidence["status"] == "PROBE_PASS":
                evidence["status"] = f"{phase.upper()}_RUNTIME_PASS"
        except (
            Blocked,
            OSError,
            KeyError,
            ValueError,
            TypeError,
            subprocess.TimeoutExpired,
            KeyboardInterrupt,
        ) as error:
            evidence["status"] = "BLOCKED"
            evidence["cleanup"] = "CLEANUP_UNCONFIRMED"
            evidence["cleanup_reason"] = (
                str(error) if isinstance(error, Blocked) else type(error).__name__
            )
        diagnostic_read.close()
        diagnostic_write.close()
        save(path, evidence)
        TRACE.reset(trace_token)
        PHASE.reset(phase_token)
    return evidence


def main():
    require(
        sys.platform == "linux" and sys.argv[1:] == [APPROVAL] and os.geteuid() == 0,
        "LINUX_OWNER_APPROVAL_AND_ROOT_REQUIRED",
    )
    import fcntl

    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host = collect(DAEMON, retained_runs=(E0B_RUN,))
        require(
            (ROOT / E0B_RUN).resolve(strict=True) == ROOT / E0B_RUN
            and (ROOT / E0B_RUN / "evidence.json").resolve(strict=True)
            == ROOT / E0B_RUN / "evidence.json",
            "E1_E0B_EVIDENCE_PATH",
        )
        prior_fd = os.open(
            ROOT / E0B_RUN / "evidence.json",
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
        )
        with os.fdopen(prior_fd, "rb") as prior:
            meta = os.fstat(prior.fileno())
            require(
                stat.S_ISREG(meta.st_mode)
                and meta.st_uid == 0
                and stat.S_IMODE(meta.st_mode) == 0o600
                and 0 < meta.st_size <= 16384,
                "E1_E0B_EVIDENCE_FILE",
            )
            require(
                hashlib.sha256(prior.read(16385)).hexdigest() == E0B_SHA,
                "E1_E0B_EVIDENCE_HASH",
            )
        current, locked = ROOT.stat(), os.fstat(fd)
        require(
            (current.st_dev, current.st_ino) == (locked.st_dev, locked.st_ino),
            "LAB_ROOT_REPLACED",
        )
        result = run_probe(host)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "E1_RUNTIME_PASS" else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (
        Blocked,
        OSError,
        KeyError,
        ValueError,
        TypeError,
        subprocess.TimeoutExpired,
        KeyboardInterrupt,
    ) as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "reason": str(error)
                    if isinstance(error, Blocked)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
