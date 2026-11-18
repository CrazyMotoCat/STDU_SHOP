"""Owner-gated E2 using the existing bounded disposable PostgreSQL lifecycle."""

import hashlib
import json
import os
import stat
import sys
from pathlib import Path

import runtime_e0b as pg
from e2_cases import Session, run_cases
from preflight import ROOT, SOCKET, Blocked, collect, require

APPROVAL = "OWNER_E2_RUNTIME_APPROVED"
RETAINED = {
    "0768c90d5d434eaea045682734e3ff85": "cb5f9c40c4dadf4e470dd2610396847b63ce130db2bcd64721d09c14d4a23255",
    "f84982069c8f41fabc90998f4c6b941f": "ffbc52da74e6e32a6be8293376b98d6fa0cc701a99cc50cda07853929b949200",
}


def retained_evidence(*, root=None, expected=None):
    root = ROOT if root is None else root
    expected = RETAINED if expected is None else expected
    payloads = {}
    for run_id, digest in expected.items():
        directory_fd = os.open(
            root / run_id, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        )
        try:
            meta = os.fstat(directory_fd)
            require(
                stat.S_ISDIR(meta.st_mode)
                and meta.st_uid == 0
                and stat.S_IMODE(meta.st_mode) == 0o700,
                "E2_RETAINED_DIRECTORY",
            )
            fd = os.open(
                "evidence.json",
                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=directory_fd,
            )
            with os.fdopen(fd, "rb") as stream:
                meta = os.fstat(stream.fileno())
                require(
                    stat.S_ISREG(meta.st_mode)
                    and meta.st_uid == 0
                    and stat.S_IMODE(meta.st_mode) == 0o600
                    and 0 < meta.st_size <= 16384,
                    "E2_RETAINED_FILE",
                )
                raw = stream.read(16385)
                require(hashlib.sha256(raw).hexdigest() == digest, "E2_RETAINED_SHA256")
                payloads[run_id] = raw
        finally:
            os.close(directory_fd)
    return payloads


def scenario(deadline, ledger, evidence):
    database = "wb_lab_" + ledger["run_id"]

    def factory(end):
        return Session(
            [
                "docker",
                "--host",
                f"unix://{SOCKET}",
                "container",
                "exec",
                "-i",
                ledger["container_id"],
                "psql",
                "-X",
                "-qAt",
                "-v",
                "ON_ERROR_STOP=1",
                "-h",
                "/var/run/postgresql",
                "-U",
                "wb_bootstrap",
                "-d",
                database,
            ],
            end,
        )

    source = Path(ledger["volumes"]["media"]["identity"]["Mountpoint"])
    digest = pg.sentinel_hash(source)
    report = {"trials": [], "preserved_evidence": RETAINED}
    evidence["scenario"] = report
    return run_cases(factory, deadline, digest=digest, size=64, report=report)


def main():
    require(
        sys.argv[1:] == [APPROVAL] and sys.platform == "linux" and os.geteuid() == 0,
        "OWNER_E2_RUNTIME_APPROVAL_REQUIRED",
    )
    import fcntl

    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host = collect(pg.base.DAEMON, retained_runs=tuple(RETAINED))
        require(
            (ROOT.stat().st_dev, ROOT.stat().st_ino)
            == (os.fstat(fd).st_dev, os.fstat(fd).st_ino),
            "E2_ROOT_REPLACED",
        )
        retained_evidence()
        result = pg.run(host, phase="e2", scenario=scenario)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "E2_RUNTIME_PASS" else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pg.ERRORS as error:
        print(
            json.dumps(
                {
                    "status": "E2_BLOCKED",
                    "reason": str(error)
                    if isinstance(error, Blocked)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
