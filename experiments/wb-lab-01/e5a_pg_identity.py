"""Anchor the E5A PostgreSQL endpoint to a private run and an issued DB nonce."""

import os
import stat
from contextlib import contextmanager
from dataclasses import dataclass

from e5a_engine import HEX, RUN, verify_directory
from preflight import LABEL, Blocked, require

SOCKET_NAME = ".s.PGSQL.5432"
PG_CAPS = {
    "Memory": 192 * 1024**2,
    "MemorySwap": 192 * 1024**2,
    "NanoCpus": 500_000_000,
    "PidsLimit": 32,
    "NetworkMode": "none",
}


def verify_pg_container(item, *, run, container_id, image_id, socket_source, volume):
    """Confirm actual Engine configuration against a pre-established run ledger."""
    require(
        RUN.fullmatch(run) and HEX.fullmatch(container_id), "E5A_PG_LEDGER_IDENTITY"
    )
    host = item["HostConfig"]
    config = item["Config"]
    require(
        item["Id"] == container_id
        and item["Name"] == f"/wb-lab-01-e5a-{run}-postgres"
        and item["Image"] == image_id
        and config["Labels"].get(LABEL) == run
        and config["User"] == "999:999"
        and host["Privileged"] is False
        and host["ReadonlyRootfs"] is True
        and all(host.get(key) == value for key, value in PG_CAPS.items())
        and not any(
            host.get(key) for key in ("PortBindings", "Devices", "VolumesFrom", "Binds")
        ),
        "E5A_PG_CONTAINER_IDENTITY",
    )
    mounts = item["Mounts"]
    by_target = {entry["Destination"]: entry for entry in mounts}
    require(
        len(mounts) == 2 and by_target.keys() == {"/socket", "/var/lib/postgresql"},
        "E5A_PG_MOUNTS",
    )
    endpoint = by_target["/socket"]
    data = by_target["/var/lib/postgresql"]
    require(
        endpoint["Type"] == "bind"
        and endpoint["RW"] is True
        and endpoint["Source"] == socket_source
        and data["Type"] == "volume"
        and data["RW"] is True
        and data["Name"] == volume,
        "E5A_PG_MOUNTS",
    )


@dataclass(frozen=True)
class DatabaseIdentity:
    run: str
    nonce: str
    socket_device: int
    socket_inode: int
    endpoint_inode: int

    @property
    def name(self):
        return f"wb_e5a_{self.run}"

    def validate(self, expected_run):
        require(
            RUN.fullmatch(self.run)
            and self.run == expected_run
            and HEX.fullmatch(self.nonce)
            and self.socket_device >= 0
            and self.socket_inode > 0,
            "E5A_PG_LEDGER_IDENTITY",
        )

    def guard_sql(self):
        self.validate(self.run)
        return f"""
DO $e5a$ BEGIN
    IF current_database() <> '{self.name}'
       OR inet_server_addr() IS NOT NULL
       OR current_setting('max_connections')::integer <> 6
       OR pg_size_bytes(current_setting('shared_buffers')) <> 25165824
       OR NOT EXISTS (
            SELECT 1 FROM public.e5a_identity
            WHERE run_id = '{self.run}' AND nonce = '{self.nonce}'
       )
    THEN RAISE EXCEPTION 'E5A_PG_IDENTITY'; END IF;
END $e5a$;
"""


@contextmanager
def socket_directory(run_fd, identity, expected_run):
    """Hold the directory open across libpq connect, with no pathname symlink walk."""
    verify_directory(run_fd)
    identity.validate(expected_run)
    try:
        fd = os.open(
            "pg-socket",
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            dir_fd=run_fd,
        )
    except OSError as error:
        raise Blocked("E5A_PG_SOCKET_DIRECTORY") from error
    try:
        directory = os.fstat(fd)
        require(
            directory.st_uid == 999
            and stat.S_IMODE(directory.st_mode) == 0o700
            and (directory.st_dev, directory.st_ino)
            == (identity.socket_device, identity.socket_inode),
            "E5A_PG_SOCKET_DIRECTORY",
        )
        try:
            endpoint = os.stat(SOCKET_NAME, dir_fd=fd, follow_symlinks=False)
        except OSError as error:
            raise Blocked("E5A_PG_SOCKET_MISSING") from error
        require(
            stat.S_ISSOCK(endpoint.st_mode)
            and endpoint.st_uid == 999
            and stat.S_IMODE(endpoint.st_mode) == 0o700
            and endpoint.st_ino == identity.endpoint_inode
            and endpoint.st_dev == identity.socket_device,
            "E5A_PG_SOCKET_IDENTITY",
        )
        yield fd
    finally:
        os.close(fd)
