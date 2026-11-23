"""Sample apparent bytes from an already attested PostgreSQL data directory."""

import os
import stat
import time

from preflight import require

WATERMARK = 128 * 1024**2
MAX_ENTRIES = 32768
MAX_DEPTH = 24


def measure(directory, expected_identity, deadline, *, clock=time.monotonic):
    root = os.fstat(directory)
    require(
        stat.S_ISDIR(root.st_mode) and (root.st_dev, root.st_ino) == expected_identity,
        "E5A_PG_DATA_IDENTITY",
    )
    total = 0
    entries = 0

    def visit(fd, depth):
        nonlocal total, entries
        require(depth <= MAX_DEPTH, "E5A_PG_DATA_SAMPLE_BUDGET")
        with os.scandir(fd) as listing:
            for entry in listing:
                entries += 1
                require(clock() < deadline, "E5A_PG_DATA_SAMPLE_STALE")
                require(entries <= MAX_ENTRIES, "E5A_PG_DATA_SAMPLE_BUDGET")
                info = entry.stat(follow_symlinks=False)
                require(info.st_dev == root.st_dev, "E5A_PG_DATA_FOREIGN_DEVICE")
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(
                        entry.name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=fd,
                    )
                    try:
                        require(
                            os.path.samestat(info, os.fstat(child)),
                            "E5A_PG_DATA_REPLACED",
                        )
                        visit(child, depth + 1)
                    finally:
                        os.close(child)
                else:
                    require(
                        stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                        "E5A_PG_DATA_UNKNOWN_ENTRY",
                    )
                    total += info.st_size
                    require(total < WATERMARK, "E5A_PG_DATA_WATERMARK")

    visit(directory, 0)
    require(clock() < deadline, "E5A_PG_DATA_SAMPLE_STALE")
    return total
