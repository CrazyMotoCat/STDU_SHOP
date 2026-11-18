"""Archive exactly one failed E0a evidence directory after read-only resource checks."""

import json
import os
import stat
import subprocess
import sys
import time

from preflight import ROOT, Blocked, engine_info, require
from runtime_e0a import DAEMON, HEX_ID, inspect

RUN = "f031a15fd2554ba3a8df9fe802ecdc7f"
EXPECTED_CONTAINER = "62a0b084bce0b31d3ab9d186af7719f49794b551bcea5322b818426c9447a93c"
ARCHIVE = ROOT.with_name("stdu-wb-lab-01-evidence")


def validate_saved(saved):
    ledger = saved["ledger"]
    require(
        saved["status"] == "BLOCKED"
        and saved["reason"] == "TimeoutExpired"
        and saved["cleanup"] == "CONFIRMED"
        and saved["foreign_inventory"] == "PRESERVED",
        "EVIDENCE_STATE",
    )
    require(
        ledger["run_id"] == RUN
        and ledger["name"] == "wb-lab-01-e0a-" + RUN
        and ledger["container_create_requested"] is True
        and ledger["volume_create_requested"] is True
        and ledger["container_id"] == EXPECTED_CONTAINER
        and HEX_ID.fullmatch(ledger["container_id"]),
        "EVIDENCE_IDENTITY",
    )
    require(
        ledger["volume"]["Mountpoint"]
        == "/mnt/data/docker/lib/volumes/" + ledger["name"] + "/_data",
        "EVIDENCE_VOLUME",
    )
    return ledger


def private_directory(path):
    info = path.lstat()
    require(
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == os.geteuid()
        and stat.S_IMODE(info.st_mode) == 0o700,
        "DIRECTORY_OWNER_MODE",
    )


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def confirm_absence(ledger):
    require(engine_info()["ID"] == DAEMON, "ARCHIVE_DAEMON_MISMATCH")
    deadline = time.monotonic() + 8
    require(
        inspect(deadline, "container", ledger["container_id"]) is None
        and inspect(deadline, "container", ledger["name"]) is None
        and inspect(deadline, "volume", ledger["name"]) is None,
        "RESOURCES_NOT_ABSENT",
    )


def archive():
    require(sys.platform == "linux" and os.geteuid() == 0, "LINUX_ROOT_REQUIRED")
    import fcntl

    private_directory(ROOT)
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(sorted(p.name for p in ROOT.iterdir()) == [RUN], "LAB_CONTENTS")
        source = ROOT / RUN
        private_directory(source)
        require(
            sorted(p.name for p in source.iterdir()) == ["evidence.json"],
            "RUN_CONTENTS",
        )
        evidence = source / "evidence.json"
        meta = evidence.lstat()
        require(
            stat.S_ISREG(meta.st_mode)
            and meta.st_uid == os.geteuid()
            and meta.st_size <= 16384,
            "EVIDENCE_FILE",
        )
        ledger = validate_saved(json.loads(evidence.read_text()))
        confirm_absence(ledger)
        # mkdir may inherit SGID from /mnt/data. Clear it only on a newly created owned archive.
        try:
            ARCHIVE.mkdir(mode=0o700)
        except FileExistsError:
            private_directory(ARCHIVE)
        else:
            os.chmod(ARCHIVE, 0o700, follow_symlinks=False)
            private_directory(ARCHIVE)
        target = ARCHIVE / RUN
        require(
            not target.exists()
            and not target.is_symlink()
            and ARCHIVE.stat().st_dev == ROOT.stat().st_dev,
            "ARCHIVE_DESTINATION",
        )
        os.rename(source, target)
        sync(ROOT)
        sync(ARCHIVE)
        sync(ARCHIVE.parent)
        require(not any(ROOT.iterdir()), "LAB_NOT_EMPTY")
        return {"status": "EVIDENCE_ARCHIVED", "run_id": RUN, "lab_root": "EMPTY"}
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        require(sys.argv[1:] == ["ARCHIVE_CONFIRMED_TIMEOUT"], "ARCHIVE_ARGUMENT")
        print(json.dumps(archive()))
    except (
        Blocked,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        subprocess.TimeoutExpired,
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
