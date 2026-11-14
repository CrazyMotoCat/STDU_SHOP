"""Seven synthetic file faults. Only forked children and exact owned keys are touched."""

import errno
import hashlib
import json
import os
import selectors
import signal
import stat
import sys
import time
from pathlib import Path

PAYLOAD = b"WB synthetic recovery original\n" * 1024
FOREIGN = b"synthetic foreign object - preserve"
CASES = (
    "kill_partial",
    "kill_synced",
    "kill_promoted",
    "io_write",
    "io_fsync",
    "io_promote",
    "foreign_collision",
)


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def create(directory, key, data):
    fd = os.open(
        key,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    try:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            need(n > 0, "WRITE_NO_PROGRESS")
            view = view[n:]
        os.fsync(fd)
        return os.fstat(fd)
    finally:
        os.close(fd)


def inspect(directory, key):
    fd = os.open(key, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    try:
        meta = os.fstat(fd)
        need(
            stat.S_ISREG(meta.st_mode)
            and meta.st_uid == os.getuid()
            and meta.st_size <= len(PAYLOAD),
            "OBJECT_IDENTITY",
        )
        data = os.read(fd, len(PAYLOAD) + 1)
        return (meta.st_dev, meta.st_ino), hashlib.sha256(data).hexdigest(), len(data)
    finally:
        os.close(fd)


def attempt(stage, final, key, fault, checkpoint):
    fd = os.open(
        key, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage
    )
    try:
        os.write(fd, PAYLOAD[:16])
        if fault == "kill_partial":
            checkpoint()
        if fault == "io_write":
            raise OSError(errno.EIO, "INJECTED_WRITE")
        view = memoryview(PAYLOAD)[16:]
        while view:
            n = os.write(fd, view)
            need(n > 0, "WRITE_NO_PROGRESS")
            view = view[n:]
        if fault == "io_fsync":
            raise OSError(errno.EIO, "INJECTED_FSYNC")
        os.fsync(fd)
        os.fsync(stage)
        if fault == "kill_synced":
            checkpoint()
        if fault == "io_promote":
            raise OSError(errno.EIO, "INJECTED_PROMOTE")
        os.link(key, key, src_dir_fd=stage, dst_dir_fd=final, follow_symlinks=False)
        if fault == "kill_promoted":
            checkpoint()
        os.fsync(final)
    finally:
        os.close(fd)


def wait_child(pid, deadline):
    while time.monotonic() < deadline:
        found, status = os.waitpid(pid, os.WNOHANG)
        if found:
            return status
        time.sleep(0.001)
    raise RuntimeError("CHILD_EXIT_UNCONFIRMED")


def interrupt(stage, final, key, fault):
    reader, writer = os.pipe()
    ack_r, ack_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        try:
            os.close(reader)
            os.close(ack_w)

            def checkpoint():
                os.write(writer, b"B")
                os.read(ack_r, 1)

            attempt(stage, final, key, fault, checkpoint)
        finally:
            os._exit(91)
    os.close(writer)
    os.close(ack_r)
    reaped = False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(reader, selectors.EVENT_READ)
            need(selector.select(1), "CHILD_BARRIER_TIMEOUT")
            need(os.read(reader, 1) == b"B", "CHILD_BARRIER_FAILED")
        os.kill(pid, signal.SIGKILL)
        status = wait_child(pid, time.monotonic() + 1)
        reaped = True
        need(
            os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL,
            "CHILD_NOT_INTERRUPTED",
        )
        return signal.SIGKILL.name
    finally:
        if not reaped:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            wait_child(pid, time.monotonic() + 1)
        os.close(reader)
        os.close(ack_w)


def recover(stage, final, key):
    expected = hashlib.sha256(PAYLOAD).hexdigest()
    try:
        original = inspect(final, key)
    except FileNotFoundError:
        retry = key + ".retry"
        meta = create(stage, retry, PAYLOAD)
        os.fsync(stage)
        os.link(retry, key, src_dir_fd=stage, dst_dir_fd=final, follow_symlinks=False)
        original = inspect(final, key)
        need(original[0] == (meta.st_dev, meta.st_ino), "PROMOTION_IDENTITY")
    need(original[1:] == (expected, len(PAYLOAD)), "RECOVERY_FOREIGN_OR_CORRUPT")
    fd = os.open(key, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=final)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(final)
    os.fsync(stage)
    return original


def run(root):
    root.mkdir(mode=0o700)
    (root / "stage").mkdir(mode=0o700)
    (root / "final").mkdir(mode=0o700)
    for directory in (root.parent, root, root / "stage", root / "final"):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    stage = os.open(root / "stage", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    final = os.open(root / "final", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        need(os.fstat(stage).st_dev == os.fstat(final).st_dev, "CROSS_DEVICE")
        create(final, "foreign", FOREIGN)
        canary = inspect(final, "foreign")
        rows = []
        for n, fault in enumerate(CASES, 1):
            key = "object_" + str(n)
            start = time.monotonic()
            if fault == "foreign_collision":
                create(final, key, FOREIGN)
                collision = inspect(final, key)
                try:
                    attempt(stage, final, key, fault, lambda: None)
                except FileExistsError:
                    need(
                        inspect(stage, key)[1:]
                        == (hashlib.sha256(PAYLOAD).hexdigest(), len(PAYLOAD)),
                        "COLLISION_STAGE_MISSING",
                    )
                else:
                    raise RuntimeError("PROMOTION_REPLACED_FOREIGN")
                boundary = {"fault": "EEXIST", "final_present": True}
                for _ in range(2):
                    try:
                        recover(stage, final, key)
                    except RuntimeError as error:
                        need(
                            str(error) == "RECOVERY_FOREIGN_OR_CORRUPT",
                            "UNEXPECTED_RECOVERY_ERROR",
                        )
                    else:
                        raise RuntimeError("FOREIGN_OVERWRITE")
                need(inspect(final, key) == collision, "FOREIGN_CHANGED")
                identity, digest, size = collision
                recovered_ms = 0
            else:
                if fault.startswith("kill_"):
                    evidence_fault = interrupt(stage, final, key, fault)
                else:
                    try:
                        attempt(stage, final, key, fault, lambda: None)
                    except OSError as error:
                        need(
                            error.errno == errno.EIO
                            and error.strerror
                            == {
                                "io_write": "INJECTED_WRITE",
                                "io_fsync": "INJECTED_FSYNC",
                                "io_promote": "INJECTED_PROMOTE",
                            }[fault],
                            "UNEXPECTED_IO_ERROR",
                        )
                        evidence_fault = "INJECTED_EIO"
                    else:
                        raise RuntimeError("FAULT_NOT_INJECTED")
                staged = inspect(stage, key)
                expected_stage = (
                    PAYLOAD[:16] if fault in {"kill_partial", "io_write"} else PAYLOAD
                )
                need(
                    staged[1:]
                    == (
                        hashlib.sha256(expected_stage).hexdigest(),
                        len(expected_stage),
                    ),
                    "INTERRUPTION_STAGE_BOUNDARY",
                )
                if fault == "kill_promoted":
                    need(
                        inspect(final, key) == staged, "INTERRUPTION_PROMOTED_BOUNDARY"
                    )
                else:
                    try:
                        inspect(final, key)
                    except FileNotFoundError:
                        pass
                    else:
                        raise RuntimeError("INTERRUPTION_UNEXPECTED_FINAL")
                boundary = {
                    "fault": evidence_fault,
                    "stage_size": staged[2],
                    "final_present": fault == "kill_promoted",
                }
                recovery_start = time.monotonic()
                identity, digest, size = recover(stage, final, key)
                need(
                    recover(stage, final, key) == (identity, digest, size),
                    "RECOVERY_NOT_IDEMPOTENT",
                )
                if fault == "kill_promoted":
                    need(identity == staged[0], "RECOVERY_PROMOTED_INODE_CHANGED")
                recovered_ms = round((time.monotonic() - recovery_start) * 1000, 3)
            need(inspect(final, "foreign") == canary, "FOREIGN_CHANGED")
            rows.append(
                {
                    "case": fault,
                    "key": key,
                    "before_recovery": boundary,
                    "sha256": digest,
                    "size": size,
                    "identity": list(identity),
                    "recovery_ms": recovered_ms,
                    "elapsed_ms": round((time.monotonic() - start) * 1000, 3),
                    "expected": "REFUSED"
                    if fault == "foreign_collision"
                    else "RECOVERED",
                }
            )
        for n in (8, 9, 10):
            create(final, "object_" + str(n), PAYLOAD)
        os.fsync(final)
        return {
            "trials": rows,
            "foreign_identity": list(canary[0]),
            "foreign_sha256": canary[1],
        }
    finally:
        os.close(stage)
        os.close(final)


def main():
    import resource

    resource.setrlimit(resource.RLIMIT_FSIZE, (len(PAYLOAD), len(PAYLOAD)))
    # Executed with bounded lab_metrics source prepended; no extra mounts/import paths.
    expected = json.loads(sys.argv[1])
    actual = isolation(expected)  # noqa: F821
    result = run(Path("/media") / "e3-work" / "objects")
    print(json.dumps({**result, **actual, "metrics": read_metrics()}))  # noqa: F821


if __name__ == "__main__":
    main()
