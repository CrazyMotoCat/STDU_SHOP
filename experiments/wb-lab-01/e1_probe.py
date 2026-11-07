"""Synthetic ext4 operations executed inside the bounded E1 controller."""

import hashlib
import json
import os
import stat
import time
from contextlib import ExitStack
from pathlib import Path

PAYLOAD = b"WB-LAB-01 synthetic E1\n" * 4096
CANARY = b"independent synthetic object"
CASES = ("promotion", "exclusive_collision", "promotion_collision")


def create(fd, name, payload, step):
    file = os.open(
        name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd
    )
    try:
        step("write", lambda: write_all(file, payload))
        step("file_fsync", lambda: os.fsync(file))
        return os.fstat(file)
    finally:
        os.close(file)


def write_all(fd, payload):
    while payload:
        count = os.write(fd, payload)
        if count <= 0:
            raise OSError("E1_WRITE_NO_PROGRESS")
        payload = payload[count:]


def digest(fd, name):
    file = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(file, "rb") as stream:
        meta = os.fstat(stream.fileno())
        if not stat.S_ISREG(meta.st_mode) or meta.st_size > len(PAYLOAD):
            raise RuntimeError("E1_OBJECT_TYPE_OR_SIZE")
        return (meta.st_dev, meta.st_ino), hashlib.sha256(
            stream.read(len(PAYLOAD) + 1)
        ).hexdigest()


def trial(stage, final, case):
    trace = []

    def step(label, operation):
        before = time.monotonic_ns()
        result = operation()
        trace.append({"step": label, "us": (time.monotonic_ns() - before) // 1000})
        return result

    key = case
    if case == "exclusive_collision":
        original = digest(stage, key)
        try:
            create(stage, key, PAYLOAD, step)
        except FileExistsError:
            trace.append({"step": "exclusive_refused"})
        else:
            raise RuntimeError("E1_EXCLUSIVE_NOT_ENFORCED")
        if digest(stage, key) != original:
            raise RuntimeError("E1_COLLISION_CHANGED")
        return {
            "case": case,
            "trace": trace,
            "identity": original[0],
            "sha256": original[1],
        }

    original = digest(final, key) if case == "promotion_collision" else None
    meta = create(stage, key, PAYLOAD, step)
    step("stage_fsync", lambda: os.fsync(stage))
    try:
        step(
            "promote",
            lambda: os.link(
                key, key, src_dir_fd=stage, dst_dir_fd=final, follow_symlinks=False
            ),
        )
    except FileExistsError:
        if (
            original is None
            or digest(final, key) != original
            or digest(stage, key)
            != ((meta.st_dev, meta.st_ino), hashlib.sha256(PAYLOAD).hexdigest())
        ):
            raise RuntimeError("E1_COLLISION_CHANGED") from None
        trace.append({"step": "promotion_refused"})
        return {
            "case": case,
            "trace": trace,
            "identity": original[0],
            "sha256": original[1],
        }
    if original is not None:
        raise RuntimeError("E1_PROMOTION_REPLACED")
    step("final_fsync", lambda: os.fsync(final))
    ident, actual = digest(final, key)
    if (
        ident != (meta.st_dev, meta.st_ino)
        or actual != hashlib.sha256(PAYLOAD).hexdigest()
    ):
        raise RuntimeError("E1_PROMOTION_INTEGRITY")
    step("stage_unlink", lambda: os.unlink(key, dir_fd=stage))
    step("stage_cleanup_fsync", lambda: os.fsync(stage))
    return {"case": case, "trace": trace, "identity": ident, "sha256": actual}


def run(root):
    with ExitStack() as stack:
        dirs = []
        for name in ("stage", "final"):
            path = root / name
            path.mkdir(mode=0o700)
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, fd)
            dirs.append(fd)
        stage, final = dirs
        root_device = root.stat().st_dev
        if any(os.fstat(fd).st_dev != root_device for fd in dirs):
            raise RuntimeError("E1_DEVICE")
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        stack.callback(os.close, root_fd)
        os.fsync(root_fd)
        for fd, key in (
            (stage, "exclusive_collision"),
            (final, "promotion_collision"),
            (final, "canary"),
        ):
            create(fd, key, CANARY, lambda _, op: op())
            os.fsync(fd)
        canary = digest(final, "canary")
        results = []
        for case in CASES:
            started = time.monotonic_ns()
            result = trial(stage, final, case)
            result["elapsed_us"] = (time.monotonic_ns() - started) // 1000
            if digest(final, "canary") != canary:
                raise RuntimeError("E1_CANARY_CHANGED")
            results.append(result)
        return results


def main():
    import resource

    resource.setrlimit(resource.RLIMIT_FSIZE, (len(PAYLOAD), len(PAYLOAD)))
    cgroup = Path("/sys/fs/cgroup")
    root = Path("/media")
    results = run(root)
    usage = resource.getrusage(resource.RUSAGE_SELF)
    dev = root.stat().st_dev
    print(
        json.dumps(
            {
                "trials": results,
                "device": f"{os.major(dev)}:{os.minor(dev)}",
                "uid": os.getuid(),
                "interfaces": sorted(os.listdir("/sys/class/net")),
                "limits": {
                    name: (cgroup / name).read_text().strip()
                    for name in ("memory.max", "memory.swap.max", "cpu.max", "pids.max")
                },
                "metrics": {
                    "rss_peak_kib": usage.ru_maxrss,
                    "user_s": usage.ru_utime,
                    "system_s": usage.ru_stime,
                    **{
                        name: (cgroup / name).read_text().strip()
                        for name in ("memory.peak", "cpu.stat", "io.stat")
                    },
                },
            }
        )
    )


if __name__ == "__main__":
    main()
