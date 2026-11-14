"""Read-only E0a policy. Input is captured Docker/host metadata, never credentials."""

import re
from dataclasses import dataclass
from pathlib import PurePosixPath

LABEL = "stdu.vis-cat-02c.run"
RUN_ID = re.compile(r"[a-f0-9]{32}")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")


class GateRejected(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise GateRejected(reason)


@dataclass(frozen=True)
class ApprovedHost:
    context: str
    daemon_id: str
    media_device_uuid: str
    kernel: str


def verify_host(host, approved):
    require(host["context"] == approved.context, "DOCKER_CONTEXT")
    require(host["daemon_id"] == approved.daemon_id, "DOCKER_DAEMON")
    require(
        host["kernel"] == approved.kernel and "microsoft" not in host["kernel"].lower(),
        "TARGET_KERNEL",
    )
    require(host["filesystem"] == "ext4", "EXT4_REQUIRED")
    require(host["device_uuid"] == approved.media_device_uuid, "DEVICE_UUID")
    require(host["device_bytes"] == 4 * 1024**3, "DEVICE_CAPACITY")
    require(host["free_bytes"] >= 1024**3, "DISK_WATERMARK")
    require(host["stage_device"] == host["final_device"], "CROSS_DEVICE")
    require(host["stage_device"] == host["device_number"], "UNAPPROVED_DEVICE")
    options = set(host["mount_options"])
    require({"rw", "relatime", "data=ordered"} <= options, "MOUNT_OPTIONS")
    require(
        not ({"nobarrier", "barrier=0", "data=writeback"} & options), "UNSAFE_MOUNT"
    )


def verify_inventory(run_id, ledger, inventory, forbidden_ids):
    """Ledger entries originate from confirmed create responses, not prefixes."""
    require(RUN_ID.fullmatch(run_id) is not None, "RUN_ID")
    require(len(ledger) == 5, "RESOURCE_COUNT")
    require(
        {item["role"] for item in ledger}
        == {"media", "pgdata", "controller", "postgres", "network"},
        "RESOURCE_ROLES",
    )
    require(len({item["id"] for item in ledger}) == len(ledger), "DUPLICATE_ID")
    require(len({item["name"] for item in ledger}) == len(ledger), "DUPLICATE_NAME")
    roles = {item["role"]: item for item in ledger}
    for entry in ledger:
        require(
            entry["created"] is True and entry["absent_before_create"] is True,
            "CREATION_NOT_PROVEN",
        )
        require(entry["id"] not in forbidden_ids, "FOREIGN_RESOURCE")
        require(entry["id"] in inventory, "OWNERSHIP_UNPROVEN")
        resource = inventory[entry["id"]]
        require(
            resource["id"] == entry["id"] and resource["name"] == entry["name"],
            "RESOURCE_IDENTITY",
        )
        require(resource.get("labels", {}).get(LABEL) == run_id, "OWNERSHIP_UNPROVEN")
        if entry["role"] in {"media", "pgdata"}:
            require(
                resource["driver"] == "local" and not resource["options"],
                "VOLUME_DRIVER",
            )
        elif entry["role"] == "network":
            require(resource["internal"] is True, "NETWORK_EXTERNAL")
        else:
            require(DIGEST.fullmatch(resource["image"]) is not None, "IMAGE_DIGEST")
            require(
                resource["privileged"] is False and resource["read_only"] is True,
                "CONTAINER_PRIVILEGE",
            )
            require(
                resource["cap_drop"] == ["ALL"] and resource["no_new_privileges"],
                "CONTAINER_CAPABILITIES",
            )
            require(
                not resource["ports"]
                and resource["pid_mode"] == ""
                and resource["ipc_mode"] == "private",
                "HOST_BOUNDARY",
            )
            require(resource["networks"] == [roles["network"]["id"]], "NETWORK_ID")
            expected_mounts = (
                [(roles["media"]["id"], "/media")]
                if entry["role"] == "controller"
                else [(roles["pgdata"]["id"], "/var/lib/postgresql")]
            )
            require(resource["mounts"] == expected_mounts, "MOUNT_ALLOWLIST")
            require(
                all(
                    not PurePosixPath(path).is_relative_to("/var/run/docker.sock")
                    for _, path in resource["mounts"]
                ),
                "DOCKER_SOCKET",
            )
            require(resource["memory_swap"] == resource["memory"], "SWAP")
            expected = (
                (256 * 1024**2, 64, "65534:65534")
                if entry["role"] == "controller"
                else (512 * 1024**2, 64, "999:999")
            )
            require(
                (resource["memory"], resource["pids"], resource["user"]) == expected
                and resource["nano_cpus"] == 1_000_000_000,
                "RESOURCE_BUDGET",
            )
    return {"gate": "E0a", "status": "ACCEPTED_METADATA", "run_id": run_id}


def verify_decoder(container, uid):
    """Network-none boundary for the first laboratory transport profile."""
    require(
        container["pid_mode"] == ""
        and container["ipc_mode"] == "private"
        and container["ports"] == [],
        "DECODER_HOST_NAMESPACE",
    )
    require(
        container["network_mode"] == "none" and container["networks"] == [],
        "DECODER_NETWORK",
    )
    require(
        container["mounts"] == [] and container["credential_env"] == [],
        "DECODER_DATA_ACCESS",
    )
    require(
        container["user"] == uid
        and container["privileged"] is False
        and container["read_only"]
        and container["cap_drop"] == ["ALL"]
        and container["no_new_privileges"],
        "DECODER_PRIVILEGE",
    )
    require(
        container["memory"] == 256 * 1024**2
        and container["memory_swap"] == container["memory"]
        and container["pids"] == 32
        and container["nano_cpus"] == 1_000_000_000,
        "DECODER_BUDGET",
    )
    return True


def verify_initialization(run_id, expected_media, expected_db, observed):
    require(RUN_ID.fullmatch(run_id) is not None, "RUN_ID")
    require(
        expected_media != expected_db
        and len(expected_media) == 64
        and len(expected_db) == 64,
        "SENTINEL_CONFIGURATION",
    )
    require(
        observed["media_sentinel"] == expected_media
        and observed["db_sentinel"] == expected_db,
        "SENTINEL_MISMATCH",
    )
    require(observed["database"] == "vis_cat_02c_" + run_id, "DATABASE_NAME")
    require(
        set(observed["tables"]) == {"lab_sentinel", "lab_intent", "lab_reference"},
        "DATABASE_SCHEMA",
    )
    require(
        not observed["superuser"]
        and not observed["createdb"]
        and not observed["createrole"],
        "DATABASE_ROLE",
    )
    return {"gate": "E0b", "status": "ACCEPTED_IDENTITY", "run_id": run_id}


def verify_media_binding(
    run_id, host, approved, ledger, inventory, forbidden_ids, observed
):
    """Join synthetic mount observations to the approved device and owned media volume."""
    verify_host(host, approved)
    verify_inventory(run_id, ledger, inventory, forbidden_ids)
    media = next(item for item in ledger if item["role"] == "media")
    source = PurePosixPath(observed["source"])
    require(source.is_absolute() and ".." not in source.parts, "UNVERIFIED_PATH")
    require(
        observed["canonical_source"] == str(source)
        and observed["source"] == inventory[media["id"]].get("mountpoint"),
        "UNVERIFIED_PATH",
    )
    require(observed["volume_id"] == media["id"], "MOUNT_OWNERSHIP")
    require(
        observed["device_uuid"] == approved.media_device_uuid
        and observed["device_number"] == host["device_number"]
        and observed["filesystem"] == "ext4",
        "MOUNT_DEVICE",
    )
    return {"gate": "E0a", "status": "MOCK_BINDING_ACCEPTED", "run_id": run_id}
