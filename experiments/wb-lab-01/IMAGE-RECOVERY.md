# LOCAL_IMAGE_ID correction and failed-run preservation

Read-only Docker Engine 29.9.2 observation on WB confirmed that inspection of the pinned `docker.io/library/python@sha256:591aae3636984765cba4e358b8e514c5ce7ed8093230592f3d2cccc590af71b8` returns `RepoDigests` containing `python@sha256:591aae3636984765cba4e358b8e514c5ce7ed8093230592f3d2cccc590af71b8`, with Linux/ARM64. The old string-membership check rejected that equivalent official Docker Hub reference.

The validator now accepts an explicit list of Docker Hub official-python aliases only. Every accepted alias must contain the exact pinned digest. It independently validates Linux, ARM64, optional ARM variant v8 and the full local sha256 image ID. The container continues to start by that inspected ID. Foreign registries/repositories, different digest, tag-only references, missing RepoDigests or wrong platform are rejected.

## Preserve the previous failed attempt

The previous run `b96cbb2833714162b7e394f028a44a80` failed before Docker create requests, with confirmed cleanup and preserved foreign inventory. Keep this evidence until owner acceptance. The following procedure only moves that exact run directory to a sibling archive on the same filesystem. It refuses symlinks, unexpected files, mismatched evidence or an existing archive destination. It leaves a private archive and restores an empty laboratory root. Execute after reviewing the code revision, with no concurrent laboratory process. This archival command is separate from runtime approval and creates no Docker resources.

```sh
python3 -B - <<'PY'
import fcntl
import json
import os
import stat
from pathlib import Path

run = "b96cbb2833714162b7e394f028a44a80"
root = Path("/mnt/data/stdu-wb-lab-01")
archive = Path("/mnt/data/stdu-wb-lab-01-evidence")
source = root / run
target = archive / run

def private_directory(path):
    meta = path.lstat()
    if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.geteuid() or stat.S_IMODE(meta.st_mode) != 0o700:
        raise RuntimeError("Directory ownership/type/mode refused")

def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

private_directory(root)
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if sorted(p.name for p in root.iterdir()) != [run]:
        raise RuntimeError("Unexpected laboratory contents")
    private_directory(source)
    if sorted(p.name for p in source.iterdir()) != ["evidence.json"]:
        raise RuntimeError("Unexpected evidence contents")
    evidence = source / "evidence.json"
    if not stat.S_ISREG(evidence.lstat().st_mode) or evidence.stat().st_uid != os.geteuid():
        raise RuntimeError("Evidence type/owner refused")
    saved = json.loads(evidence.read_text())
    ledger = saved["ledger"]
    if not (ledger["run_id"] == run and saved["status"] == "BLOCKED"
            and saved["reason"] == "LOCAL_IMAGE_ID" and saved["cleanup"] == "CONFIRMED"
            and saved["foreign_inventory"] == "PRESERVED"
            and ledger["container_create_requested"] is False
            and ledger["volume_create_requested"] is False):
        raise RuntimeError("Evidence does not authorize this archival procedure")
    archive.mkdir(mode=0o700, exist_ok=True)
    private_directory(archive)
    if target.exists() or target.is_symlink() or archive.stat().st_dev != root.stat().st_dev:
        raise RuntimeError("Archive destination refused")
    os.rename(source, target)
    sync(root)
    sync(archive)
    sync(archive.parent)
    if list(root.iterdir()):
        raise RuntimeError("Laboratory root is not empty")
    print("EVIDENCE_ARCHIVED / LAB_ROOT_EMPTY")
finally:
    os.close(fd)
PY
```

If the script refuses, retain the directories and investigate its reason. Do not use a recursive deletion command to bypass a refusal. A successfully archived run must remain outside the empty lab root, and its JSON should be redacted before sharing.

## Retry package after separate owner authorization

Use the reviewed new PR HEAD. First run the read-only host preflight again. Confirm the pinned image is still local. The prior failed run does not count as a runtime resource PASS.

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY \
  python3 -B experiments/wb-lab-01/preflight.py be35948b-8382-4d17-b83e-9f4ab90b9954
```

After fresh host PASS and the owner's renewed runtime authorization:

```sh
env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY \
  python3 -B experiments/wb-lab-01/runtime_e0a.py OWNER_E0A_RUNTIME_APPROVED
```

E0b–E5 remain NOT_RUN.
