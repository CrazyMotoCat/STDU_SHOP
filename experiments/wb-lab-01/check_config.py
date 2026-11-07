"""Fail-closed checks for a rendered WB-LAB-01 Compose configuration."""

import json
import re
import sys

from preflight import MIB, Blocked, require

CAPS = {
    "postgres": (192, 32, 0.5, "999:999"),
    "controller": (64, 16, 0.25, "65532:65532"),
}
POSTGRES_TMPFS = {
    "/tmp": {"size=8m", "mode=1777", "nosuid", "nodev", "noexec"},
    "/var/run/postgresql": {"size=2m", "mode=1777", "nosuid", "nodev", "noexec"},
}
LABEL = "stdu.wb-lab-01.run"


def validate(config, run_id):
    require(re.fullmatch(r"[0-9a-f]{32}", run_id), "INVALID_RUN_ID")
    project = "wb-lab-01-" + run_id
    require(config["name"] == project, "PROJECT_NAME")
    require(set(config["services"]) == set(CAPS), "SERVICE_SET")
    require(set(config["volumes"]) == {"pgdata", "media"}, "VOLUME_SET")
    for role, volume in config["volumes"].items():
        require(
            volume["name"] == f"{project}_{role}"
            and volume["driver"] == "local"
            and not volume.get("external")
            and not volume.get("driver_opts")
            and volume["labels"][LABEL] == run_id,
            "VOLUME_OWNERSHIP",
        )
    require(set(config["networks"]) == {"lab"}, "NETWORK_SET")
    network = config["networks"]["lab"]
    require(
        network["name"] == f"{project}_lab"
        and network["internal"] is True
        and not network.get("external")
        and network["labels"][LABEL] == run_id,
        "NETWORK_OWNERSHIP",
    )
    secrets = config["secrets"]
    require(set(secrets) == {"pg_password"}, "SECRET_SET")
    require(
        secrets["pg_password"].get("file")
        == f"/mnt/data/stdu-wb-lab-01/{run_id}/pg_password",
        "SECRET_SOURCE",
    )
    for role, (memory, pids, cpus, user) in CAPS.items():
        service = config["services"][role]
        require(
            service["platform"] == "linux/arm64"
            and service["user"] == user
            and service["pull_policy"] == "never"
            and service["labels"][LABEL] == run_id,
            "SERVICE_IDENTITY",
        )
        require(
            int(service["mem_limit"]) == int(service["memswap_limit"]) == memory * MIB
            and service["pids_limit"] == pids
            and float(service["cpus"]) == cpus,
            "SERVICE_BUDGET",
        )
        require(
            service["read_only"] is True
            and service["cap_drop"] == ["ALL"]
            and service["security_opt"] == ["no-new-privileges:true"]
            and service["ipc"] == "private"
            and service["restart"] == "no"
            and not any(
                service.get(k)
                for k in (
                    "privileged",
                    "ports",
                    "pid",
                    "devices",
                    "volumes_from",
                    "container_name",
                    "cap_add",
                    "extra_hosts",
                    "env_file",
                    "build",
                    "develop",
                )
            ),
            "SERVICE_ISOLATION",
        )
        require(
            not service.get("profiles")
            and not service.get("network_mode")
            and set(service["networks"]) == {"lab"},
            "SERVICE_NETWORK",
        )
        [volume] = service["volumes"]
        expected = (
            ("pgdata", "/var/lib/postgresql")
            if role == "postgres"
            else ("media", "/media")
        )
        require(
            (volume["source"], volume["target"]) == expected
            and volume["type"] == "volume",
            "SERVICE_MOUNT",
        )
        tmpfs = {}
        for entry in service.get("tmpfs", []):
            target, separator, options = entry.partition(":")
            values = options.split(",")
            require(
                separator and target not in tmpfs and len(values) == len(set(values)),
                "TMPFS_ENTRY",
            )
            tmpfs[target] = set(values)
        require(
            tmpfs == (POSTGRES_TMPFS if role == "postgres" else {}), "TMPFS_PROFILE"
        )
    require(
        config["services"]["postgres"]["environment"]
        == {
            "POSTGRES_DB": "wb_lab_" + run_id,
            "POSTGRES_USER": "wb_lab_bootstrap",
            "POSTGRES_PASSWORD_FILE": "/run/secrets/pg_password",
        },
        "POSTGRES_IDENTITY",
    )
    require(
        config["services"]["postgres"]["secrets"]
        in (
            [{"source": "pg_password"}],
            [{"source": "pg_password", "target": "/run/secrets/pg_password"}],
        )
        and not config["services"]["controller"].get("secrets")
        and not config["services"]["controller"].get("environment"),
        "SERVICE_SECRET_SCOPE",
    )
    return {"status": "CONFIG_PASS", "project": project, "container_memory_mib": 256}


if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "RUN_ID_REQUIRED")
        print(json.dumps(validate(json.load(sys.stdin), sys.argv[1])))
    except (Blocked, KeyError, TypeError, ValueError) as error:
        reason = str(error) if isinstance(error, Blocked) else type(error).__name__
        print(json.dumps({"status": "BLOCKED", "reason": reason}))
        sys.exit(1)
