"""Durable PostgreSQL create/start recovery over the Slice 01 Engine transport."""

import json
import os
import stat
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlencode

from e5a_engine import CONFIG, HEX, Intent, verify_directory
from e5a_libpq import Peer
from e5a_pg_identity import PG_CAPS, SOCKET_NAME, DatabaseIdentity, verify_pg_container
from e5a_pg_watermark import measure
from e5a_sql import query as sql_query
from preflight import LABEL, require
from runtime_e0a import owned_volume
from runtime_e0b import IMAGE, seed_volume, validate_image, volume_source
from runtime_e5a import process_start, read_bounded

INITIALIZE = (
    "set -eu; ulimit -f 65536; "
    "initdb -D /var/lib/postgresql/data -U wb_bootstrap --locale=C "
    "--auth-local=trust --auth-host=reject --no-instructions >/dev/null; "
)
SERVE = (
    "exec postgres -D /var/lib/postgresql/data -c listen_addresses= "
    "-c unix_socket_directories=/socket -c unix_socket_permissions=0700 "
    "-c max_connections=6 -c shared_buffers=24MB -c lock_timeout=1000 "
    "-c statement_timeout=2500"
)


@dataclass(frozen=True)
class PostgresIntent(Intent):
    socket_source: str
    nonce: str

    @property
    def name(self):
        return f"wb-lab-01-e5a-{self.run}-postgres"

    @property
    def volume(self):
        return f"wb-lab-01-e5a-{self.run}-pg"

    def command(self):
        self.validate()
        require(HEX.fullmatch(self.nonce), "E5A_PG_LEDGER_IDENTITY")
        db = f"wb_e5a_{self.run}"
        single = "postgres --single -D /var/lib/postgresql/data "
        return [
            "-ec",
            INITIALIZE
            + f"{single} postgres >/dev/null <<'E5A_CREATE'\nCREATE DATABASE {db};\nE5A_CREATE\n"
            + f"{single} {db} >/dev/null <<'E5A_SCHEMA'\n"
            + "CREATE TABLE public.e5a_identity(run_id text PRIMARY KEY, nonce text NOT NULL);\n"
            + f"INSERT INTO public.e5a_identity VALUES ('{self.run}', '{self.nonce}');\n"
            + "CREATE TABLE public.e5a_measurement(id integer PRIMARY KEY, payload text NOT NULL);\n"
            + "E5A_SCHEMA\n"
            + SERVE,
        ]


def write_record(directory, key, value):
    verify_directory(directory)
    buffer = json.dumps(value, sort_keys=True).encode("ascii")
    require(len(buffer) <= 4096, "E5A_PG_LEDGER_SIZE")
    fd = os.open(
        key,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=directory,
    )
    with os.fdopen(fd, "wb") as record:
        os.fchmod(record.fileno(), 0o600)
        record.write(buffer)
        record.flush()
        os.fsync(record.fileno())
    os.fsync(directory)


def read_record(directory, key, *, optional=False):
    verify_directory(directory)
    try:
        fd = os.open(key, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    except FileNotFoundError:
        if optional:
            return None
        raise
    with os.fdopen(fd, "rb") as record:
        meta = os.fstat(record.fileno())
        require(
            stat.S_ISREG(meta.st_mode)
            and meta.st_uid == os.geteuid()
            and stat.S_IMODE(meta.st_mode) == 0o600
            and meta.st_nlink == 1,
            "E5A_PG_LEDGER_FILE",
        )
        payload = record.read(4097)
    require(0 < len(payload) <= 4096, "E5A_PG_LEDGER_SIZE")
    return json.loads(payload)


class PostgresEngine:
    def __init__(self, engine, prepare_volume):
        self.engine = engine
        self.prepare_volume = prepare_volume

    @classmethod
    def for_preflight(cls, engine, host):
        def prepare(volume, intent):
            path = volume_source(volume, host, intent.run, intent.volume)
            before = path.stat()
            seed_volume(path, intent.run, True)
            after = path.stat()
            require(os.path.samestat(before, after), "E5A_PG_VOLUME_IDENTITY")
            return after.st_dev, after.st_ino

        return cls(engine, prepare)

    def ready(self, directory, intent, deadline):
        rows = self.query(
            directory,
            intent,
            "BEGIN READ ONLY; /* attest */ SELECT 1; COMMIT;",
            deadline,
        )
        require(rows == ["1"], "E5A_PG_NOT_READY")
        fd = os.open(
            "pg-socket", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
        )
        try:
            entries = {}
            for name, kind in (
                (SOCKET_NAME, stat.S_ISSOCK),
                (SOCKET_NAME + ".lock", stat.S_ISREG),
            ):
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                require(
                    kind(info.st_mode) and info.st_uid == 999 and info.st_nlink == 1,
                    "E5A_PG_SOCKET_IDENTITY",
                )
                entries[name] = [info.st_dev, info.st_ino]
            write_record(directory, "pg-socket-entries.json", entries)
        finally:
            os.close(fd)

    def inspect_volume(self, intent, deadline):
        return self.engine.request(
            "GET", f"/volumes/{intent.volume}", deadline, statuses=(200, 404)
        )

    def connection_identity(self, directory, intent, deadline):
        require(
            read_record(directory, "pg-intent.json") == asdict(intent),
            "E5A_PG_INTENT_CHANGED",
        )
        record = read_record(directory, "pg-container.json")
        require(
            set(record) == {"id"} and HEX.fullmatch(record["id"]),
            "E5A_PG_LEDGER_INCOMPLETE",
        )
        identifier = record["id"]
        self.engine.attest(intent, deadline)
        item = self.engine.inspect(identifier, deadline)
        self.verify(item, intent, identifier)
        pid = item["State"]["Pid"]
        require(
            item["State"]["Running"] is True and type(pid) is int and pid > 0,
            "E5A_PG_NOT_RUNNING",
        )
        start = process_start(Path("/proc") / str(pid), pid)
        cgroup = Path("/proc") / str(pid) / "cgroup"
        membership = read_bounded(cgroup).strip()
        require(
            membership.startswith("0::/")
            and "\n" not in membership
            and Path(membership[3:]).name in {identifier, f"docker-{identifier}.scope"},
            "E5A_PG_PEER_CGROUP",
        )
        fd = os.open(
            "pg-socket", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
        )
        try:
            current = os.fstat(fd)
            source = Path(intent.socket_source)
            require(
                source.resolve(strict=True) == source
                and os.path.samestat(current, source.stat()),
                "E5A_PG_SOCKET_DIRECTORY",
            )
            endpoint = os.stat(SOCKET_NAME, dir_fd=fd, follow_symlinks=False)
            require(stat.S_ISSOCK(endpoint.st_mode), "E5A_PG_SOCKET_IDENTITY")
            identity = DatabaseIdentity(
                intent.run,
                intent.nonce,
                current.st_dev,
                current.st_ino,
                endpoint.st_ino,
            )
        finally:
            os.close(fd)
        self.engine.attest(intent, deadline)
        after = self.engine.inspect(identifier, deadline)
        self.verify(after, intent, identifier)
        require(
            after["State"]["Running"] is True
            and after["State"]["Pid"] == pid
            and process_start(Path("/proc") / str(pid), pid) == start
            and read_bounded(cgroup).strip() == membership,
            "E5A_PG_PEER_IDENTITY",
        )
        return identity, Peer(pid, start)

    def query(self, directory, intent, sql, deadline):
        require(
            read_record(directory, "paired-abort.json", optional=True) is None,
            "E5A_PAIRED_ABORTED",
        )
        self.sample_data(directory, intent, deadline)
        identity, peer = self.connection_identity(directory, intent, deadline)
        rows = sql_query(directory, identity, intent.run, sql, deadline, peer=peer)
        require(
            read_record(directory, "paired-abort.json", optional=True) is None,
            "E5A_PAIRED_ABORTED",
        )
        return rows

    def sample_data(self, directory, intent, deadline):
        require(
            read_record(directory, "pg-intent.json") == asdict(intent),
            "E5A_PG_INTENT_CHANGED",
        )
        record = read_record(directory, "pg-volume.json")
        data = read_record(directory, "pg-data.json")
        self.engine.attest(intent, deadline)
        volume = owned_volume(
            self.inspect_volume(intent, deadline), intent.volume, intent.run
        )
        require(
            all(record[key] == volume[key] for key in ("CreatedAt", "Mountpoint")),
            "E5A_PG_VOLUME_IDENTITY",
        )
        source = Path(record["Mountpoint"])
        require(
            source.is_absolute() and source.resolve(strict=True) == source,
            "E5A_PG_VOLUME_PATH",
        )
        fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            require(set(data) == {"identity"}, "E5A_PG_LEDGER_INCOMPLETE")
            return measure(fd, tuple(data["identity"]), deadline)
        finally:
            os.close(fd)

    def create(self, directory, intent, deadline):
        command = intent.command()
        socket_path = Path(intent.socket_source)
        require(
            socket_path.is_absolute() and socket_path.name == "pg-socket",
            "E5A_PG_SOCKET_DIRECTORY",
        )
        socket_fd = os.open(
            "pg-socket", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory
        )
        try:
            actual = os.fstat(socket_fd)
            require(
                socket_path.resolve(strict=True) == socket_path
                and os.path.samestat(actual, socket_path.stat())
                and actual.st_uid == 999
                and stat.S_IMODE(actual.st_mode) == 0o700,
                "E5A_PG_SOCKET_DIRECTORY",
            )
            write_record(
                directory,
                "pg-socket.json",
                {"identity": [actual.st_dev, actual.st_ino]},
            )
        finally:
            os.close(socket_fd)
        engine = self.engine
        engine.attest(intent, deadline)
        require(
            validate_image(engine.request("GET", f"/images/{IMAGE}/json", deadline))
            == intent.image,
            "E5A_PG_IMAGE",
        )
        require(
            self.inspect_volume(intent, deadline) is None
            and engine.inspect(intent.name, deadline) is None,
            "E5A_PG_NAME_COLLISION",
        )
        write_record(directory, "pg-intent.json", asdict(intent))
        engine.attest(intent, deadline)
        engine.request(
            "POST",
            "/volumes/create",
            deadline,
            statuses=(201,),
            body={
                "Name": intent.volume,
                "Driver": "local",
                "Labels": {LABEL: intent.run},
            },
        )
        volume = owned_volume(
            self.inspect_volume(intent, deadline), intent.volume, intent.run
        )
        record = {key: volume[key] for key in ("CreatedAt", "Mountpoint")}
        write_record(directory, "pg-volume.json", record)
        data_identity = self.prepare_volume(volume, intent)
        if data_identity is not None:
            write_record(directory, "pg-data.json", {"identity": list(data_identity)})
        write_record(directory, "pg-create.json", {"requested": True})
        engine.attest(intent, deadline)
        request = {
            "Image": intent.image,
            "User": "999:999",
            "Labels": {LABEL: intent.run},
            "Entrypoint": ["/bin/sh"],
            "Cmd": command,
            "StopSignal": "SIGINT",
            "NetworkDisabled": True,
            "HostConfig": {
                **CONFIG,
                **PG_CAPS,
                "Tmpfs": {"/tmp": "size=8m,mode=1777,nosuid,nodev,noexec"},
                "ShmSize": 16 * 1024**2,
                "Mounts": [
                    {
                        "Type": "bind",
                        "Source": intent.socket_source,
                        "Target": "/socket",
                    },
                    {
                        "Type": "volume",
                        "Source": intent.volume,
                        "Target": "/var/lib/postgresql",
                        "VolumeOptions": {"NoCopy": True},
                    },
                ],
            },
        }
        answer = engine.request(
            "POST",
            f"/containers/create?name={intent.name}",
            deadline,
            statuses=(201,),
            body=request,
        )
        identifier = answer["Id"]
        require(HEX.fullmatch(identifier), "E5A_PG_CONTAINER_IDENTITY")
        self.verify(engine.inspect(identifier, deadline), intent, identifier)
        write_record(directory, "pg-container.json", {"id": identifier})
        write_record(directory, "pg-start.json", {"requested": True})
        engine.attest(intent, deadline)
        engine.request(
            "POST", f"/containers/{identifier}/start", deadline, statuses=(204,)
        )
        return identifier

    @staticmethod
    def verify(item, intent, identifier):
        require(item is not None, "E5A_PG_CONTAINER_MISSING")
        verify_pg_container(
            item,
            run=intent.run,
            container_id=identifier,
            image_id=intent.image,
            socket_source=intent.socket_source,
            volume=intent.volume,
        )
        require(
            item["Config"]["Entrypoint"] == ["/bin/sh"]
            and item["Config"]["Cmd"] == intent.command()
            and item["Config"]["NetworkDisabled"] is True
            and item["Config"]["StopSignal"] == "SIGINT",
            "E5A_PG_CONTAINER_COMMAND",
        )

    def recover(self, directory, intent, deadline):
        def verify_intent():
            require(
                read_record(directory, "pg-intent.json") == asdict(intent),
                "E5A_PG_INTENT_CHANGED",
            )

        engine = self.engine
        verify_intent()
        engine.attest(intent, deadline)
        volume_record = read_record(directory, "pg-volume.json")
        create_record = read_record(directory, "pg-create.json", optional=True)
        container_record = read_record(directory, "pg-container.json", optional=True)
        require(
            create_record in (None, {"requested": True})
            and (
                container_record is None
                or (
                    create_record is not None
                    and set(container_record) == {"id"}
                    and HEX.fullmatch(container_record["id"])
                )
            ),
            "E5A_PG_LEDGER_INCOMPLETE",
        )

        def volume_identity():
            volume = self.inspect_volume(intent, deadline)
            if volume is not None:
                owned_volume(volume, intent.volume, intent.run)
                require(
                    volume_record
                    == {key: volume[key] for key in ("CreatedAt", "Mountpoint")},
                    "E5A_PG_VOLUME_IDENTITY",
                )
            return volume is not None

        candidate = engine.inspect(intent.name, deadline)
        identifier = container_record["id"] if container_record else None
        volume_present = volume_identity()
        if candidate is None:
            require(
                create_record is None or identifier is not None, "E5A_PG_CREATE_UNKNOWN"
            )
            require(
                identifier is None or engine.inspect(identifier, deadline) is None,
                "E5A_PG_CONTAINER_REMAINS",
            )
        else:
            require(
                create_record is not None and volume_present, "E5A_PG_LEDGER_INCOMPLETE"
            )
            identifier = identifier or candidate["Id"]
            self.verify(candidate, intent, identifier)
            engine.attest(intent, deadline)
            self.verify(engine.inspect(identifier, deadline), intent, identifier)
            verify_intent()
            if container_record is None:
                # Persist the recovered exact ID so a second watchdog can attest absence.
                write_record(directory, "pg-container.json", {"id": identifier})
            if candidate["State"]["Running"]:
                engine.request(
                    "POST",
                    f"/containers/{identifier}/stop?t=1",
                    deadline,
                    statuses=(204,),
                )
            engine.attest(intent, deadline)
            self.verify(engine.inspect(identifier, deadline), intent, identifier)
            engine.request(
                "DELETE",
                f"/containers/{identifier}?v=false&force=false",
                deadline,
                statuses=(204,),
            )
            require(
                engine.inspect(identifier, deadline) is None
                and engine.inspect(intent.name, deadline) is None,
                "E5A_PG_CONTAINER_REMAINS",
            )
        if volume_present:
            engine.attest(intent, deadline)
            filters = urlencode(
                {"all": 1, "filters": json.dumps({"volume": [intent.volume]})}
            )
            rows = engine.request(
                "GET", f"/containers/json?{filters}", deadline, shape=list
            )
            require(rows == [], "E5A_PG_VOLUME_ATTACHED")
            require(volume_identity(), "E5A_PG_VOLUME_IDENTITY")
            engine.request(
                "DELETE", f"/volumes/{intent.volume}", deadline, statuses=(204,)
            )
            require(
                self.inspect_volume(intent, deadline) is None, "E5A_PG_VOLUME_REMAINS"
            )
