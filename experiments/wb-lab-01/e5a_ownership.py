"""Fail-closed Docker cleanup for resources recorded before creation."""

from dataclasses import dataclass

import runtime_e0a as docker
from preflight import require


@dataclass(frozen=True)
class Resource:
    kind: str
    name: str
    identifier: str | None = None
    created_at: str | None = None
    mountpoint: str | None = None


def cleanup(deadline, run_id, resources, attest_daemon, *, engine=docker):
    """Confirm every identity before mutation, and remove writers before volumes."""
    require(
        len(run_id) == 32 and all(c in "0123456789abcdef" for c in run_id), "E5A_RUN_ID"
    )
    resources = tuple(resources)
    prefix = f"wb-lab-01-e5a-{run_id}-"
    names = {
        "container": {
            prefix + name for name in ("controller", "postgres", "paired-controller")
        },
        "volume": {prefix + name for name in ("media", "paired-media", "pg")},
    }
    require(
        len({item.name for item in resources}) == len(resources)
        and all(item.name in names.get(item.kind, ()) for item in resources),
        "E5A_LEDGER_RESOURCES",
    )

    def inspect_owned(resource):
        attest_daemon(deadline)
        if resource.kind == "container":
            ref = resource.identifier or resource.name
            item = engine.inspect(deadline, resource.kind, ref)
            if item is None:
                require(resource.identifier is not None, "E5A_CREATE_UNCONFIRMED")
                require(
                    engine.inspect(deadline, resource.kind, resource.name) is None,
                    "E5A_NAME_REUSED",
                )
                return None
            identifier = item["Id"]
            require(docker.HEX_ID.fullmatch(identifier), "E5A_CONTAINER_ID")
            docker.owned_container(
                item, resource.name, run_id, resource.identifier or identifier
            )
            return identifier
        item = engine.inspect(deadline, resource.kind, resource.name)
        if item is None:
            require(resource.created_at is not None, "E5A_CREATE_UNCONFIRMED")
            return None
        docker.owned_volume(item, resource.name, run_id)
        require(
            resource.created_at is not None
            and resource.mountpoint is not None
            and (item["CreatedAt"], item["Mountpoint"])
            == (resource.created_at, resource.mountpoint),
            "E5A_VOLUME_IDENTITY",
        )
        return resource.name

    observed = {resource: inspect_owned(resource) for resource in resources}
    for kind in ("container", "volume"):
        for resource, ref in observed.items():
            if resource.kind != kind or ref is None:
                continue
            require(inspect_owned(resource) == ref, "E5A_RESOURCE_CHANGED")
            if kind == "container":
                engine.checked(deadline, kind, "rm", "--force", ref)
            else:
                require(
                    not engine.checked(
                        deadline, "container", "ls", "-aq", "--filter", f"volume={ref}"
                    ),
                    "E5A_VOLUME_ATTACHED",
                )
                require(inspect_owned(resource) == ref, "E5A_RESOURCE_CHANGED")
                engine.checked(deadline, kind, "rm", ref)
            attest_daemon(deadline)
            require(
                engine.inspect(deadline, kind, ref) is None
                and engine.inspect(deadline, kind, resource.name) is None,
                "E5A_RESOURCE_REMAINS",
            )
