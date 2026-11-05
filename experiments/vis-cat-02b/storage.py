import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path("/scratch")
DATA = b"synthetic media bytes"


def sync_directory():
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def crash_at(point, stop):
    if point == stop:
        os._exit(71)


def write(key, stage, stop):
    with stage.open("xb") as file:
        file.write(DATA)
        file.flush()
        crash_at("write", stop)
        os.fsync(file.fileno())
    crash_at("file-sync", stop)
    sync_directory()
    crash_at("stage-sync", stop)
    os.link(stage, key)
    crash_at("promote", stop)
    sync_directory()
    crash_at("promotion-sync", stop)
    stage.unlink()
    sync_directory()
    crash_at("cleanup-sync", stop)


def attempt(key, stage, stop):
    return subprocess.run([sys.executable, __file__, key.name, stage.name, stop],
                          timeout=5, capture_output=True, check=False).returncode


def probe():
    registered = ROOT / "registered"
    unrelated = ROOT / "unrelated-stage"
    registered.write_bytes(b"already referenced")
    unrelated.write_bytes(b"belongs to another intent")
    sync_directory()
    results = []
    for point in ("write", "file-sync", "stage-sync", "promote", "promotion-sync", "cleanup-sync"):
        key, stage = ROOT / f"object-{point}", ROOT / f"stage-{point}"
        assert attempt(key, stage, point) == 71
        present = key.exists()
        assert present == (point in ("promote", "promotion-sync", "cleanup-sync"))
        if present:
            assert key.read_bytes() == DATA
        if stage.exists():
            assert attempt(key, stage, "none") == 73
            stage.unlink()
            sync_directory()
        if present:
            assert attempt(key, stage, "none") == 73
            assert key.read_bytes() == DATA
            stage.unlink()
            sync_directory()
        else:
            assert attempt(key, stage, "none") == 0
        assert key.read_bytes() == DATA
        assert registered.read_bytes() == b"already referenced"
        assert unrelated.read_bytes() == b"belongs to another intent"
        results.append(dict(point=point, promoted_on_restart=present, retry="verified",
                            sha256=hashlib.sha256(key.read_bytes()).hexdigest()))
    collision_stage = ROOT / "stage-collision"
    assert attempt(registered, collision_stage, "none") == 73
    assert registered.read_bytes() == b"already referenced"
    collision_stage.unlink()
    sync_directory()
    return dict(exclusive_create=True, no_replace=True, fsync_file_and_directory=True,
                registered_preserved=True, unrelated_preserved=True, crash_cases=results)


if __name__ == "__main__":
    if len(sys.argv) == 4:
        try:
            write(ROOT / sys.argv[1], ROOT / sys.argv[2], sys.argv[3])
        except FileExistsError:
            sys.exit(73)
    else:
        print(json.dumps(probe()))
