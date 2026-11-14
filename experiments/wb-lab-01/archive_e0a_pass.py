"""Prepared archival of the accepted E0a result; does not execute during import."""

import hashlib
import json
import os
import stat
import sys

from archive_timeout import ARCHIVE, confirm_absence, private_directory, sync
from preflight import ROOT, require
from runtime_e0b import APPROVAL, ERRORS

RUN = "23ceb807c68f4ae0bed724def6e58d68"
SHA256 = "3b3a29f2f7788baebc40f44c69bbcfb4afb84dc89649d42b7e6ba832ed3a4c4e"
CONTAINER = "754be1d96599e8398b9ab635756007fab0ef961fd24a3a53f196f95310b20b5e"


def authorize():
    require(
        sys.argv[1:] == [APPROVAL] and sys.platform == "linux" and os.geteuid() == 0,
        "OWNER_E0B_RUNTIME_APPROVAL_REQUIRED",
    )


def archive():
    authorize()
    import fcntl

    private_directory(ROOT)
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(
            sorted(p.name for p in ROOT.iterdir()) == [RUN], "ARCHIVE_ROOT_CONTENTS"
        )
        source = ROOT / RUN
        private_directory(source)
        require(
            sorted(p.name for p in source.iterdir()) == ["evidence.json"],
            "ARCHIVE_RUN_CONTENTS",
        )
        file = source / "evidence.json"
        meta = file.lstat()
        require(
            stat.S_ISREG(meta.st_mode)
            and meta.st_uid == os.geteuid()
            and meta.st_size <= 16384,
            "ARCHIVE_EVIDENCE_FILE",
        )
        data = file.read_bytes()
        require(hashlib.sha256(data).hexdigest() == SHA256, "ARCHIVE_EVIDENCE_HASH")
        saved = json.loads(data)
        ledger = saved["ledger"]
        require(
            saved["status"] == "E0A_RUNTIME_PASS"
            and saved["cleanup"] == "CONFIRMED"
            and saved["foreign_inventory"] == "PRESERVED"
            and ledger["run_id"] == RUN
            and ledger["container_id"] == CONTAINER
            and ledger["name"] == "wb-lab-01-e0a-" + RUN,
            "ARCHIVE_EVIDENCE_STATE",
        )
        confirm_absence(ledger)
        private_directory(ARCHIVE)
        target = ARCHIVE / RUN
        require(
            not target.exists()
            and not target.is_symlink()
            and ROOT.stat().st_dev == ARCHIVE.stat().st_dev,
            "ARCHIVE_DESTINATION",
        )
        # Existing archive already has verified 0700; never chmod an unexpected directory.
        os.rename(source, target)
        sync(ROOT)
        sync(ARCHIVE)
        require(
            hashlib.sha256((target / "evidence.json").read_bytes()).hexdigest()
            == SHA256
            and not any(ROOT.iterdir()),
            "ARCHIVE_POSTCHECK",
        )
        return {"status": "E0A_EVIDENCE_ARCHIVED", "run_id": RUN, "sha256": SHA256}
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        print(json.dumps(archive()))
    except ERRORS as error:
        print(
            json.dumps(
                {
                    "status": "BLOCKED",
                    "reason": str(error)
                    if isinstance(error, RuntimeError)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
