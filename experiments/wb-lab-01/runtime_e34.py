"""Prepared E3/E3b then E4a cycle. WB execution requires one separate owner approval."""

import json
import os
import stat
import sys
from pathlib import Path

import e4_probe
import runtime_e0a as base
import runtime_e0b as pg
import runtime_e2 as e2
from preflight import Blocked, require

APPROVAL = "OWNER_E3_E4A_RUNTIME_APPROVED"
RETAINED = {
    **e2.RETAINED,
    "d609b33a167d471185d20308b4fbc0c8": "92a9ff282021348b282b684f475dbf878f668a59e4f1c2aed881b6d68e904ca2",
}


def e4_validate(result, device):
    require(
        result["limits"] == base.LIMITS
        and result["uid"] == 65532
        and result["device"] == device
        and result["interfaces"] == ["lo"],
        "E4_ACTUAL_ISOLATION",
    )
    rows = result["trials"]
    expected = (
        ["positive_ipv4_tcp", "positive_ipv4_udp"]
        + [row[0] for row in e4_probe.NEGATIVE]
        + ["namespace_routes_mounts"]
    )
    require([row["case"] for row in rows] == expected, "E4_CASE_SET")
    require(
        all(
            row["observed"] is True and row["scope"] == "namespace_loopback"
            for row in rows[:2]
        ),
        "E4_POSITIVE_CONTROL",
    )
    require(
        all(
            row["sent"] is False and row["errno"] in e4_probe.DENIAL
            for row in rows[2:7]
        ),
        "E4_DENIAL",
    )
    require(
        rows[7]["interfaces"] == ["lo"]
        and rows[7]["ipv4_routes"] == 0
        and rows[7]["ipv6_non_loopback_routes"] == 0
        and rows[7]["configured_mounts"] == ["/media"]
        and rows[7]["media_read_only"] is True,
        "E4_TOPOLOGY",
    )
    require(
        set(result["metrics"])
        >= {"rss_peak_kib", "memory.peak", "cpu.stat", "io.stat"},
        "E4_METRICS",
    )


def empty_volume(deadline, ledger):
    item = base.owned_volume(
        base.inspect(deadline, "volume", ledger["name"]),
        ledger["name"],
        ledger["run_id"],
    )
    require(
        all(item[key] == ledger["volume"][key] for key in ("CreatedAt", "Mountpoint")),
        "E4_VOLUME_CHANGED",
    )
    path = Path(item["Mountpoint"])
    require(path.resolve(strict=True) == path, "E4_VOLUME_PATH")
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        meta = os.fstat(fd)
        require(
            meta.st_uid == 65532
            and stat.S_IMODE(meta.st_mode) == 0o700
            and not os.listdir(fd),
            "E4_UNEXPECTED_STORAGE_CONTENT",
        )
    finally:
        os.close(fd)


def main():
    require(sys.argv[1:] == [APPROVAL], "OWNER_E3_E4A_RUNTIME_APPROVAL_REQUIRED")
    raise Blocked("COMBINED_E3_E4A_RETIRED")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except pg.ERRORS as error:
        print(
            json.dumps(
                {
                    "status": "E3_E4A_BLOCKED",
                    "reason": str(error)
                    if isinstance(error, Blocked)
                    else type(error).__name__,
                }
            )
        )
        sys.exit(1)
