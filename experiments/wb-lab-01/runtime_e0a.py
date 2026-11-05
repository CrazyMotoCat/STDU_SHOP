"""Owner-gated WB-LAB-01 E0a runtime probe. No PostgreSQL or decoder workloads."""

import json
import multiprocessing
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

from preflight import (
    LABEL,
    ROOT,
    SOCKET,
    Blocked,
    collect,
    mem_available,
    mount,
    require,
    thresholds,
)

DAEMON = "be35948b-8382-4d17-b83e-9f4ab90b9954"
APPROVAL = "OWNER_E0A_RUNTIME_APPROVED"
IMAGE = "docker.io/library/python@sha256:591aae3636984765cba4e358b8e514c5ce7ed8093230592f3d2cccc590af71b8"
LIMITS = {
    "memory.max": "67108864",
    "memory.swap.max": "0",
    "cpu.max": "25000 100000",
    "pids.max": "16",
}
HEX_ID = re.compile(r"[0-9a-f]{64}")
PROBE = r"""
import json, os, signal
from pathlib import Path

signal.alarm(8)
root = Path("/sys/fs/cgroup")
device = os.stat("/media").st_dev
entries = [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()
           if line.split()[4] == "/media"]
assert len(entries) == 1 and "ro" in entries[0][5].split(",")
print(json.dumps({
    "limits": {name: (root / name).read_text().strip() for name in
               ("memory.max", "memory.swap.max", "cpu.max", "pids.max")},
    "interfaces": sorted(os.listdir("/sys/class/net")),
    "device": f"{os.major(device)}:{os.minor(device)}",
    "mount_read_only": True,
    "uid": os.getuid(),
}))
"""


def command(deadline, *args):
    remaining = deadline - time.monotonic()
    require(remaining > 0, "DEADLINE")
    return subprocess.run(
        ["docker", "--host", f"unix://{SOCKET}", *args],
        text=True,
        capture_output=True,
        timeout=min(remaining, 3),
        check=False,
    )


def checked(deadline, *args):
    result = command(deadline, *args)
    require(result.returncode == 0, f"DOCKER_{args[0].upper()}_FAILED")
    return result.stdout.strip()


def inspect(deadline, kind, ref):
    result = command(deadline, kind, "inspect", ref)
    if result.returncode:
        error = result.stderr.strip()
        if error in {
            f"{prefix}: No such {noun}: {ref}"
            for prefix in ("Error", "Error response from daemon")
            for noun in (kind, "object")
        }:
            return None
        if (
            kind == "volume"
            and error == f"Error response from daemon: get {ref}: no such volume"
        ):
            return None
        raise Blocked("INSPECT_UNCONFIRMED")
    [item] = json.loads(result.stdout)
    return item


def owned_container(item, name, run_id, container_id):
    require(
        item is not None
        and item["Id"] == container_id
        and item["Name"] == "/" + name
        and item["Config"]["Labels"].get(LABEL) == run_id,
        "CONTAINER_OWNERSHIP",
    )
    return item


def owned_volume(item, name, run_id):
    require(
        item is not None
        and item["Name"] == name
        and item["Labels"].get(LABEL) == run_id
        and item["Driver"] == "local"
        and item["Scope"] == "local"
        and not item["Options"],
        "VOLUME_OWNERSHIP",
    )
    return item


def validate_image(image):
    """Normalize only Docker Hub's explicit official-python repository aliases."""
    repository, digest = IMAGE.split("@")
    require(repository == "docker.io/library/python", "PINNED_REPOSITORY")
    allowed = {
        f"{name}@{digest}"
        for name in (
            "python",
            "library/python",
            "docker.io/python",
            "docker.io/library/python",
            "index.docker.io/python",
            "index.docker.io/library/python",
        )
    }
    image_id = image.get("Id", "")
    require(
        image.get("Os") == "linux"
        and image.get("Architecture") == "arm64"
        and image.get("Variant", "") in ("", "v8")
        and isinstance(image_id, str)
        and image_id.startswith("sha256:")
        and HEX_ID.fullmatch(image_id[7:])
        and isinstance(image.get("RepoDigests"), list)
        and all(isinstance(ref, str) for ref in image["RepoDigests"])
        and any(ref in allowed for ref in image["RepoDigests"]),
        "LOCAL_IMAGE_ID",
    )
    return image_id


def validate_container(item, image_id, volume_name, mountpoint):
    host = item["HostConfig"]
    require(
        item["Image"] == image_id and item["Config"]["User"] == "65532:65532",
        "CONTAINER_IMAGE_OR_USER",
    )
    require(
        host["NetworkMode"] == "none"
        and not item["NetworkSettings"]["Ports"]
        and not host["PortBindings"]
        and not host["PublishAllPorts"],
        "NETWORK_OR_PORTS",
    )
    require(
        host["ReadonlyRootfs"]
        and not host["Privileged"]
        and host["CgroupnsMode"] == "private"
        and host["CapDrop"] == ["ALL"]
        and host["IpcMode"] == "private"
        and host["PidMode"] == ""
        and host["LogConfig"]["Type"] == "none"
        and host["SecurityOpt"] == ["no-new-privileges"],
        "CONTAINER_ISOLATION",
    )
    require(
        (host["Memory"], host["MemorySwap"], host["NanoCpus"], host["PidsLimit"])
        == (64 * 1024**2, 64 * 1024**2, 250_000_000, 16),
        "CONTAINER_CONFIG_LIMITS",
    )
    [attached] = item["Mounts"]
    require(
        attached["Type"] == "volume"
        and attached["Name"] == volume_name
        and attached["Destination"] == "/media"
        and attached["Source"] == mountpoint
        and attached["RW"] is False,
        "CONTAINER_MOUNT",
    )


def validate_probe(result, device):
    require(result["limits"] == LIMITS, "ACTUAL_CGROUP_LIMITS")
    require(result["interfaces"] == ["lo"], "ACTUAL_NETWORK_INTERFACES")
    require(
        result["device"] == device
        and result["mount_read_only"] is True
        and result["uid"] == 65532,
        "ACTUAL_MOUNT_OR_UID",
    )


def watchdog(deadline, name, run_id, container_id, stop, ready):
    """Independent host process. A failed observation prevents a successful run."""
    try:
        while not stop.is_set():
            require(time.monotonic() < deadline, "WATCHDOG_DEADLINE")
            thresholds(mem_available(), shutil.disk_usage(ROOT).free)
            item = owned_container(
                inspect(deadline, "container", container_id), name, run_id, container_id
            )
            require(
                item["State"]["Status"] in {"created", "running", "exited"}
                and not item["State"]["OOMKilled"],
                "WATCHDOG_STATE",
            )
            ready.set()
            stop.wait(0.25)
    except (
        Blocked,
        OSError,
        KeyError,
        ValueError,
        TypeError,
        subprocess.TimeoutExpired,
    ):
        abort_deadline = time.monotonic() + 4
        try:
            item = inspect(abort_deadline, "container", container_id)
            if item is not None:
                owned_container(item, name, run_id, container_id)
                # Invalidate the exact ID even if the parent has not issued start yet.
                checked(abort_deadline, "container", "rm", "--force", container_id)
                require(
                    inspect(abort_deadline, "container", container_id) is None,
                    "WATCHDOG_REMOVAL_UNCONFIRMED",
                )
        except (
            Blocked,
            OSError,
            KeyError,
            ValueError,
            TypeError,
            subprocess.TimeoutExpired,
        ):
            sys.exit(2)
        sys.exit(1)


def snapshot(deadline):
    return {
        kind: set(checked(deadline, kind, "ls", *args).splitlines())
        for kind, args in (
            ("container", ("-aq", "--no-trunc")),
            ("volume", ("-q",)),
            ("network", ("-q", "--no-trunc")),
        )
    }


def save(path, evidence):
    payload = json.dumps(evidence, indent=2) + "\n"
    require(len(payload.encode()) <= 16_384, "EVIDENCE_BUDGET")
    pending = path.with_suffix(".tmp")
    with pending.open("x", encoding="utf-8") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    pending.replace(path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def cleanup(deadline, ledger):
    name, run_id = ledger["name"], ledger["run_id"]
    ref = ledger.get("container_id", name)
    if ledger["container_create_requested"]:
        item = inspect(deadline, "container", ref)
        if item is None:
            require("container_id" in ledger, "CONTAINER_CREATE_UNCERTAIN")
        else:
            container_id = item["Id"]
            require(HEX_ID.fullmatch(container_id), "CONTAINER_ID_FORMAT")
            owned_container(
                item, name, run_id, ledger.get("container_id", container_id)
            )
            ledger["container_id"] = container_id
            checked(deadline, "container", "rm", "--force", container_id)
            require(
                inspect(deadline, "container", container_id) is None,
                "CONTAINER_REMAINS",
            )
    if ledger["volume_create_requested"]:
        volume = inspect(deadline, "volume", name)
        if volume is None:
            require("volume" in ledger, "VOLUME_CREATE_UNCERTAIN")
        else:
            owned_volume(volume, name, run_id)
            identity = {key: volume[key] for key in ("CreatedAt", "Mountpoint")}
            require(
                identity == ledger.get("volume", identity), "VOLUME_IDENTITY_CHANGED"
            )
            require(
                not checked(
                    deadline, "container", "ls", "-aq", "--filter", f"volume={name}"
                ),
                "VOLUME_STILL_ATTACHED",
            )
            checked(deadline, "volume", "rm", name)
            require(inspect(deadline, "volume", name) is None, "VOLUME_REMAINS")


def run_probe(host):
    run_id = uuid.uuid4().hex
    name = "wb-lab-01-e0a-" + run_id
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
        "ledger": ledger,
        "cleanup": "NOT_RUN",
        "E0b_to_E5": "NOT_RUN",
        "VDS_equivalence": "NOT_PROVEN",
    }
    deadline = time.monotonic() + 30
    before = None
    watcher = None
    context = multiprocessing.get_context("fork")
    stop = context.Event()
    ready = context.Event()
    try:
        before = snapshot(deadline)
        require(
            name not in before["volume"]
            and inspect(deadline, "container", name) is None,
            "RUN_NAME_COLLISION",
        )
        [image] = json.loads(checked(deadline, "image", "inspect", IMAGE))
        image_id = validate_image(image)
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
        observed = mount(source)
        device = host["mounts"]["root"]["maj:min"]
        require(
            observed["maj:min"] == device and observed["fstype"] == "ext4",
            "VOLUME_DEVICE",
        )
        evidence["volume_device"] = device
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
            f"type=volume,source={name},target=/media,readonly,volume-nocopy",
            image_id,
            "python",
            "-I",
            "-B",
            "-c",
            PROBE,
        )
        require(HEX_ID.fullmatch(container_id), "CONTAINER_ID_FORMAT")
        ledger["container_id"] = container_id
        save(path, evidence)
        item = owned_container(
            inspect(deadline, "container", container_id), name, run_id, container_id
        )
        validate_container(item, image_id, name, str(source))
        watcher = context.Process(
            target=watchdog, args=(deadline, name, run_id, container_id, stop, ready)
        )
        watcher.start()
        require(ready.wait(4) and watcher.is_alive(), "WATCHDOG_NOT_READY")
        thresholds(mem_available(), shutil.disk_usage(ROOT).free)
        result = checked(deadline, "container", "start", "--attach", container_id)
        require(len(result) <= 2048, "PROBE_OUTPUT_BUDGET")
        probe = json.loads(result)
        validate_probe(probe, device)
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
        evidence["observed"] = {
            key: probe[key] for key in ("limits", "interfaces", "device", "uid")
        }
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
        cleanup_deadline = time.monotonic() + 10
        stop.set()
        try:
            if watcher is not None and watcher.pid is not None:
                watcher.join(4)
                require(not watcher.is_alive(), "WATCHDOG_STOP_UNCONFIRMED")
                if watcher.exitcode != 0:
                    evidence["status"] = "BLOCKED"
                    evidence["reason"] = "WATCHDOG_STOP_CONDITION"
            cleanup(cleanup_deadline, ledger)
            evidence["cleanup"] = "CONFIRMED"
            if before is not None:
                after = snapshot(cleanup_deadline)
                require(
                    all(before[kind] <= after[kind] for kind in before),
                    "FOREIGN_INVENTORY_CHANGED",
                )
                evidence["foreign_inventory"] = "PRESERVED"
            if evidence["status"] == "PROBE_PASS":
                evidence["status"] = "E0A_RUNTIME_PASS"
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
        save(path, evidence)
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
        host = collect(DAEMON)
        current, locked = ROOT.stat(), os.fstat(fd)
        require(
            (current.st_dev, current.st_ino) == (locked.st_dev, locked.st_ino),
            "LAB_ROOT_REPLACED",
        )
        result = run_probe(host)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "E0A_RUNTIME_PASS" else 1
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
