"""Preserve the single reviewed failed E0b attempt before an authorized retry."""

import ctypes
import hashlib
import json
import os
import stat
import sys
import time
from contextlib import ExitStack

from archive_e0a_pass import authorize
from archive_timeout import ARCHIVE
from preflight import LABEL, ROOT, Blocked, engine_info, mount, require
from runtime_e0a import DAEMON, checked, inspect
from runtime_e0b import ERRORS, IMAGE

RUN = "742071b6115e4a00a8b65cc7151f8c39"
SHA256 = "dc5836761bd02cce2cfbe504cc5cb363afbc0658f50a249e903b2267ddd0da28"
CONTAINER = "14db3f0dc316896a070682644a6f635957cda4bd35b6fdc705d4e99a627a934e"
NAME = "wb-lab-01-e0b-" + RUN
VOLUMES = {role: NAME + "-" + role for role in ("pg", "media")}
DOCKER_ROOT = "/mnt/data/docker/lib"
FILE = "evidence.json"
MAX_BYTES = 16384


def validate_saved(saved):
    require(
        saved["status"] == "BLOCKED"
        and saved["reason"] == "E0B_DOCKER_COMMAND_FAILED"
        and saved["cleanup"] == "CONFIRMED"
        and saved["foreign_inventory"] == "PRESERVED",
        "E0B_ARCHIVE_EVIDENCE_STATE",
    )
    ledger = saved["ledger"]
    require(
        ledger["run_id"] == RUN
        and ledger["name"] == NAME
        and ledger["container_id"] == CONTAINER
        and ledger["container_create_requested"] is True
        and ledger["image_id"] == IMAGE.split("@")[1]
        and set(ledger["volumes"]) == set(VOLUMES),
        "E0B_ARCHIVE_LEDGER",
    )
    for role, name in VOLUMES.items():
        volume = ledger["volumes"][role]
        require(
            volume["name"] == name
            and volume["requested"] is True
            and volume["identity"]["Mountpoint"]
            == f"{DOCKER_ROOT}/volumes/{name}/_data"
            and volume["identity"]["CreatedAt"] == "2026-11-07T15:26:32+10:00",
            "E0B_ARCHIVE_VOLUME_LEDGER",
        )


def confirm_absence():
    require(
        not any(
            os.environ.get(key)
            for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY")
        ),
        "AMBIENT_DOCKER_TARGET",
    )
    info = engine_info()
    require(
        info["ID"] == DAEMON and info["DockerRootDir"] == DOCKER_ROOT,
        "E0B_ARCHIVE_DAEMON",
    )
    deadline = time.monotonic() + 10
    for kind, ref in (
        ("container", CONTAINER),
        ("container", NAME),
        *(("volume", name) for name in VOLUMES.values()),
    ):
        require(inspect(deadline, kind, ref) is None, "E0B_ARCHIVE_RESOURCE_PRESENT")
    for kind, flags in (("container", "-aq"), ("volume", "-q"), ("network", "-q")):
        require(
            not checked(deadline, kind, "ls", flags, "--filter", f"label={LABEL}"),
            "E0B_ARCHIVE_OTHER_LAB_RESOURCE",
        )
    require(engine_info()["ID"] == DAEMON, "E0B_ARCHIVE_DAEMON")


def directory(stack, path, *, parent=None):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    stack.callback(os.close, fd)
    meta = os.fstat(fd)
    require(
        meta.st_uid == os.geteuid() and stat.S_IMODE(meta.st_mode) == 0o700,
        "E0B_ARCHIVE_DIRECTORY_OWNER_MODE",
    )
    return fd


def identity(meta):
    return meta.st_dev, meta.st_ino


def read_evidence(run_fd):
    require(os.listdir(run_fd) == [FILE], "E0B_ARCHIVE_RUN_CONTENTS")
    fd = os.open(FILE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=run_fd)
    with os.fdopen(fd, "rb") as stream:
        meta = os.fstat(stream.fileno())
        require(
            stat.S_ISREG(meta.st_mode)
            and meta.st_uid == os.geteuid()
            and stat.S_IMODE(meta.st_mode) == 0o600
            and meta.st_nlink == 1
            and meta.st_dev == os.fstat(run_fd).st_dev
            and 0 < meta.st_size <= MAX_BYTES,
            "E0B_ARCHIVE_FILE_OWNER_MODE_TYPE",
        )
        data = stream.read(MAX_BYTES + 1)
    require(hashlib.sha256(data).hexdigest() == SHA256, "E0B_ARCHIVE_SHA256")
    return data, identity(meta)


def check_filesystem():
    # Only the previously verified WB ext4 mount. Reject separate bind mounts too.
    keys = ("target", "source", "fstype", "maj:min")
    expected = ("/", "/dev/mmcblk0p2", "ext4", "179:2")
    for path in (ROOT, ROOT / RUN, ROOT / RUN / FILE, ARCHIVE):
        observed = mount(path)
        require(
            tuple(observed[key] for key in keys) == expected
            and "rw" in observed["options"].split(","),
            "E0B_ARCHIVE_FILESYSTEM",
        )


def rename_exclusive(root_fd, archive_fd):
    # Linux RENAME_NOREPLACE also refuses a collision created after validation.
    rename = getattr(ctypes.CDLL(None, use_errno=True), "renameat2", None)
    require(rename is not None, "E0B_ARCHIVE_RENAME_UNAVAILABLE")
    rename.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    rename.restype = ctypes.c_int
    if rename(root_fd, RUN.encode("ascii"), archive_fd, RUN.encode("ascii"), 1):
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


def archive():
    authorize()
    import fcntl

    require(
        ROOT.resolve(strict=True) == ROOT and ARCHIVE.resolve(strict=True) == ARCHIVE,
        "E0B_ARCHIVE_PATH",
    )
    with ExitStack() as stack:
        root_fd = directory(stack, ROOT)
        fcntl.flock(root_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(os.listdir(root_fd) == [RUN], "E0B_ARCHIVE_ROOT_CONTENTS")
        archive_fd = directory(stack, ARCHIVE)
        run_fd = directory(stack, RUN, parent=root_fd)
        require(
            len({os.fstat(fd).st_dev for fd in (root_fd, archive_fd, run_fd)}) == 1,
            "E0B_ARCHIVE_DEVICE",
        )
        require(RUN not in os.listdir(archive_fd), "E0B_ARCHIVE_COLLISION")
        data, file_id = read_evidence(run_fd)
        validate_saved(json.loads(data))
        check_filesystem()
        confirm_absence()
        require(
            os.listdir(root_fd) == [RUN]
            and identity(ROOT.lstat()) == identity(os.fstat(root_fd))
            and identity(ARCHIVE.lstat()) == identity(os.fstat(archive_fd))
            and identity(os.stat(RUN, dir_fd=root_fd, follow_symlinks=False))
            == identity(os.fstat(run_fd))
            and read_evidence(run_fd) == (data, file_id),
            "E0B_ARCHIVE_SOURCE_CHANGED",
        )
        rename_exclusive(root_fd, archive_fd)
        # Keep evidence at the destination if fsync or verification fails after rename.
        for fd in (run_fd, archive_fd, root_fd):
            os.fsync(fd)
        moved = directory(stack, RUN, parent=archive_fd)
        require(
            identity(os.fstat(moved)) == identity(os.fstat(run_fd))
            and read_evidence(moved) == (data, file_id)
            and not os.listdir(root_fd),
            "E0B_ARCHIVE_POSTCHECK",
        )
    return {"status": "E0B_FAILED_EVIDENCE_ARCHIVED", "run_id": RUN, "sha256": SHA256}


if __name__ == "__main__":
    try:
        print(json.dumps(archive()))
    except ERRORS as error:
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
