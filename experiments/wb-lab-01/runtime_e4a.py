"""E4a-only retry. Accepted E3 is never invoked by this entry point."""

import json
import os
import sys
import time

import runtime_e0a as base
import runtime_e0b as pg
import runtime_e1 as controller
import runtime_e2 as e2
import runtime_e34 as previous
from preflight import ROOT, Blocked, collect, require

APPROVAL = "OWNER_E4A_ONLY_RUNTIME_APPROVED"
RETAINED = {
    **previous.RETAINED,
    "117941e7f5a74f99ab27087493bc0dfa": "b6f0bdc6c7abd86f77ca7ef97820a90daa5b470a4cb1cd6cd844ace7be7f3e2d",
    "bc51510604f541218d3a12671468d327": "80be049dc6a2148a43735af3b2f1b48ba9f58a65eb1389b08d37ae4149315a24",
}


def verify_history(deadline):
    payloads = e2.retained_evidence(root=ROOT, expected=RETAINED)
    inventory = base.snapshot(deadline)
    for run_id in RETAINED:
        data = json.loads(payloads[run_id])
        require(data["cleanup"] == "CONFIRMED", "E4A_HISTORY_CLEANUP")
        ledger = data["ledger"]
        require(ledger["run_id"] == run_id, "E4A_HISTORY_RUN")
        for child in [ledger] + ledger.get("auxiliary_containers", []):
            require(
                child.get("container_id") not in inventory["container"],
                "E4A_HISTORY_WRITER_PRESENT",
            )
            require(
                base.inspect(deadline, "container", child["name"]) is None,
                "E4A_HISTORY_NAME_PRESENT",
            )
        volumes = [v["name"] for v in ledger.get("volumes", {}).values()]
        if ledger.get("volume_create_requested"):
            volumes.append(ledger["name"])
        require(not (set(volumes) & inventory["volume"]), "E4A_HISTORY_VOLUME_PRESENT")


def main():
    require(
        sys.argv[1:] == [APPROVAL] and sys.platform == "linux" and os.geteuid() == 0,
        "OWNER_E4A_ONLY_RUNTIME_APPROVAL_REQUIRED",
    )
    import fcntl

    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host = collect(base.DAEMON, retained_runs=tuple(RETAINED))
        require(
            (ROOT.stat().st_dev, ROOT.stat().st_ino)
            == (os.fstat(fd).st_dev, os.fstat(fd).st_ino),
            "E4A_ROOT_REPLACED",
        )
        verify_history(time.monotonic() + 10)
        result = controller.run_probe(
            host,
            phase="e4a",
            probe_name="e4_probe.py",
            validator=previous.e4_validate,
            volume_validator=previous.empty_volume,
        )
        e2.retained_evidence(root=ROOT, expected=RETAINED)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "E4A_RUNTIME_PASS" else 1
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pg.ERRORS as error:
        print(
            json.dumps(
                {
                    "status": "E4A_BLOCKED",
                    "reason": str(error)
                    if isinstance(error, Blocked)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
