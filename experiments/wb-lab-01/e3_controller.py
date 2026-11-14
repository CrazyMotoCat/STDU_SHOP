"""One auxiliary controller, with authenticated ledger and an independent watchdog."""

import json
import multiprocessing
import os
import time
from pathlib import Path

import runtime_e0a as base
from preflight import LABEL, require


def run(deadline, ledger, evidence, record):
    child = {
        "name": ledger["name"] + "-writer",
        "run_id": ledger["run_id"],
        "container_create_requested": False,
        "volume_create_requested": False,
    }
    ledger["auxiliary_containers"] = [child]
    volume = ledger["volumes"]["media"]
    source = Path(volume["identity"]["Mountpoint"])
    # Controller owns only the new empty media directory, not any parent or sentinel.
    work = source / "e3-work"
    require(not work.exists(), "E3_WORK_EXISTS")
    require(source.resolve(strict=True) == source, "E3_MEDIA_PATH")
    item = base.owned_volume(
        base.inspect(deadline, "volume", volume["name"]),
        volume["name"],
        ledger["run_id"],
    )
    require(
        all(
            item[key] == volume["identity"][key] for key in ("CreatedAt", "Mountpoint")
        ),
        "E3_MEDIA_IDENTITY",
    )
    fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchmod(fd, 0o755)
        os.fsync(fd)
    finally:
        os.close(fd)
    [image] = json.loads(base.checked(deadline, "image", "inspect", base.IMAGE))
    image_id = base.validate_image(image)
    require(not image["Config"].get("Volumes"), "E3_CONTROLLER_IMPLICIT_VOLUME")
    require(
        base.inspect(deadline, "container", child["name"]) is None,
        "E3_CONTROLLER_COLLISION",
    )
    # New scoped directory is pre-created by the host, not a recursively writable volume.
    work.mkdir(mode=0o700)
    os.chown(work, 65532, 65532)
    # e3_probe creates its own subdirectory so no existing object is replaced.
    device = source.stat().st_dev
    expected = {
        "device": f"{os.major(device)}:{os.minor(device)}",
        "uid": 65532,
        "interfaces": ["lo"],
        "limits": base.LIMITS,
    }
    code = (
        Path(__file__).with_name("lab_metrics.py").read_text()
        + "\n"
        + Path(__file__).with_name("e3_probe.py").read_text()
    )
    child["container_create_requested"] = True
    base.save(record, evidence)
    context = multiprocessing.get_context("fork")
    stop, ready = context.Event(), context.Event()
    watcher = None
    try:
        cid = base.checked(
            deadline,
            "container",
            "create",
            "--pull=never",
            "--name",
            child["name"],
            "--label",
            f"{LABEL}={ledger['run_id']}",
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
            f"type=volume,source={volume['name']},target=/media,volume-nocopy",
            image_id,
            "python",
            "-I",
            "-B",
            "-c",
            code,
            json.dumps(expected),
        )
        require(base.HEX_ID.fullmatch(cid), "E3_CONTROLLER_ID")
        child["container_id"] = cid
        base.save(record, evidence)
        item = base.owned_container(
            base.inspect(deadline, "container", cid),
            child["name"],
            ledger["run_id"],
            cid,
        )
        require(
            len(item["Mounts"]) == 1 and item["Mounts"][0]["RW"] is True,
            "E3_CONTROLLER_MOUNT",
        )
        base.validate_container(
            {**item, "Mounts": [{**item["Mounts"][0], "RW": False}]},
            image_id,
            volume["name"],
            str(source),
        )
        watcher = context.Process(
            target=base.watchdog,
            args=(deadline, child["name"], ledger["run_id"], cid, stop, ready),
        )
        watcher.start()
        require(
            ready.wait(min(4, max(0, deadline - time.monotonic())))
            and watcher.is_alive(),
            "E3_CONTROLLER_WATCHDOG",
        )
        output = base.checked(deadline, "container", "start", "--attach", cid)
        require(len(output) <= 10000, "E3_CONTROLLER_OUTPUT")
        result = json.loads(output)
        for key, value in expected.items():
            require(result[key] == value, "E3_CONTROLLER_ACTUAL_ISOLATION")
        final = base.owned_container(
            base.inspect(deadline, "container", cid),
            child["name"],
            ledger["run_id"],
            cid,
        )
        require(
            final["State"]["Status"] == "exited"
            and final["State"]["ExitCode"] == 0
            and not final["State"]["OOMKilled"],
            "E3_CONTROLLER_EXIT",
        )
        return result
    finally:
        stop.set()
        if watcher is not None and watcher.pid is not None:
            watcher.join(min(4, max(0, deadline - time.monotonic())))
            require(
                not watcher.is_alive() and watcher.exitcode == 0,
                "E3_CONTROLLER_WATCHDOG_UNCONFIRMED",
            )
        # No separate cleanup budget: parent removes this writer first in its existing 10s cleanup.
