"""Single owner-gated entry point for the four E5A phases on the specified WB."""

import fcntl
import json
import os
import subprocess
import sys
import time
import uuid

from e5a_engine import IMAGE, Engine, validate_image
from e5a_evidence import publish
from e5a_host import HostBackend
from preflight import ROOT, collect, require
from runtime_e0a import DAEMON
from runtime_e0b import IMAGE as PG_IMAGE
from runtime_e0b import validate_image as validate_pg
from runtime_e2 import retained_evidence
from runtime_e4a import RETAINED
from runtime_e5a import FAILURES, run_campaign

APPROVAL = "OWNER_E5A_RUNTIME_APPROVED"
HISTORY = {
    **RETAINED,
    "da496b6c17c1458d86e9d4c299526c95": "70c755b6e2e83d8bdecb69f0e1541e17b0f4b2bf8d77289f18ce868c1f23cc13",
}


def main():
    require(
        sys.argv[1:] == [APPROVAL] and sys.platform == "linux" and os.geteuid() == 0,
        "OWNER_E5A_RUNTIME_APPROVAL_REQUIRED",
    )
    root = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    backend = None
    directory = None
    try:
        fcntl.flock(root, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host = collect(DAEMON, retained_runs=tuple(HISTORY))
        before = retained_evidence(root=ROOT, expected=HISTORY)
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=3,
        ).stdout.strip()
        require(
            subprocess.run(
                ["git", "status", "--porcelain", "--untracked-files=normal"],
                capture_output=True,
                text=True,
                check=True,
                timeout=3,
            ).stdout
            == "",
            "E5A_WORKTREE_DIRTY",
        )
        engine = Engine()
        preflight_end = time.monotonic() + 5
        images = {
            "controller": validate_image(
                engine.request("GET", f"/images/{IMAGE}/json", preflight_end)
            ),
            "postgres": validate_pg(
                engine.request("GET", f"/images/{PG_IMAGE}/json", preflight_end)
            ),
        }
        run = uuid.uuid4().hex
        host["nonce"] = uuid.uuid4().hex + uuid.uuid4().hex
        os.mkdir(run, 0o700, dir_fd=root)
        directory = os.open(
            run, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root
        )
        os.fchmod(directory, 0o700)
        os.fsync(root)
        backend = HostBackend(directory, run, host, images, engine=engine)
        result = run_campaign(backend)
        require(
            retained_evidence(root=ROOT, expected=HISTORY) == before,
            "E5A_HISTORY_CHANGED",
        )
        envelope = {
            "revision": revision,
            "run_id": run,
            "daemon": host["daemon_id"],
            "images": images,
            "resources": backend.resources,
            "campaign": result,
        }
        digest = publish(directory, envelope)
        print(
            json.dumps(
                {
                    "status": "E5A_RUNTIME_PASS"
                    if result["status"] == "E5A_CHECKS_PASS"
                    else "E5A_BLOCKED",
                    "run_id": run,
                    "revision": revision,
                    "evidence_sha256": digest,
                    "cleanup": result["cleanup"],
                }
            )
        )
        return 0 if result["status"] == "E5A_CHECKS_PASS" else 1
    finally:
        if backend is not None:
            backend.close()
        if directory is not None:
            os.close(directory)
        os.close(root)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except FAILURES as error:
        # Details stay in the private ledger. Do not expose arbitrary exception text.
        print(json.dumps({"status": "E5A_BLOCKED", "reason": type(error).__name__}))
        sys.exit(1)
