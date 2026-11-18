"""Bounded controller with an owned media volume and no SQL access."""

import json
import os
import stat
from pathlib import Path
from urllib.parse import urlencode

from e5a_engine import CONFIG, HEX, IMAGE, validate_image
from e5a_pg_engine import read_record, write_record
from preflight import LABEL, require
from runtime_e0a import owned_volume
from runtime_e0b import volume_source

PROBE = """
import hashlib, os, time
fd = os.open('/media', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
report = {}
for index in range(3):
    data = bytes([index]) * 65536
    stage, final = f'.stage-{index}', f'file-{index}'
    out = os.open(stage, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    with os.fdopen(out, 'wb') as stream:
        stream.write(data)
        stream.flush()
        start = time.monotonic_ns()
        os.fsync(stream.fileno())
        report[index] = (time.monotonic_ns() - start) // 1000
    os.fsync(fd)
    os.link(stage, final, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
    os.fsync(fd)
    os.unlink(stage, dir_fd=fd)
    os.fsync(fd)
    with os.fdopen(os.open(final, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd), 'rb') as stream:
        assert hashlib.sha256(stream.read(65537)).digest() == hashlib.sha256(data).digest()
with os.fdopen(os.open('complete', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd), 'w') as stream:
    stream.write(','.join(str(report[i]) for i in range(3)))
    stream.flush()
    os.fsync(stream.fileno())
os.fsync(fd)
time.sleep(30)
"""


class MediaController:
    def __init__(self, engine, intent):
        self.engine, self.intent = engine, intent
        intent.validate()
        self.volume = f"wb-lab-01-e5a-{intent.run}-media"

    def inspect_volume(self, deadline):
        return self.engine.request(
            "GET", f"/volumes/{self.volume}", deadline, statuses=(200, 404)
        )

    def identity(self, deadline):
        item = self.inspect_volume(deadline)
        if item is None:
            return None
        owned_volume(item, self.volume, self.intent.run)
        return {key: item[key] for key in ("CreatedAt", "Mountpoint")}

    def verify(self, item, cid, volume):
        intent = self.intent
        require(item is not None, "E5A_MEDIA_CONTROLLER_MISSING")
        host, config = item["HostConfig"], item["Config"]
        require(
            HEX.fullmatch(cid)
            and item["Id"] == cid
            and item["Name"] == "/" + intent.name
            and item["Image"] == config["Image"] == intent.image
            and config["Labels"].get(LABEL) == intent.run
            and config["Entrypoint"] == ["/usr/local/bin/python"]
            and config["Cmd"] == ["-I", "-S", "-c", PROBE]
            and config["User"] == "65534:65534"
            and config["NetworkDisabled"] is True
            and all(host.get(k) == v for k, v in CONFIG.items())
            and host["Privileged"] is False
            and not any(host.get(k) for k in ("CapAdd", "PidMode", "UTSMode"))
            and item["NetworkSettings"]["Ports"] in ({}, None)
            and not any(
                host.get(k) for k in ("Binds", "PortBindings", "VolumesFrom", "Devices")
            ),
            "E5A_MEDIA_CONTROLLER_OWNERSHIP",
        )
        mounts = item["Mounts"]
        require(len(mounts) == 1, "E5A_MEDIA_CONTROLLER_MOUNT")
        entry = mounts[0]
        require(
            entry["Type"] == "volume"
            and entry["Name"] == self.volume
            and entry["Source"] == volume["Mountpoint"]
            and entry["Destination"] == "/media"
            and entry["RW"] is True,
            "E5A_MEDIA_CONTROLLER_MOUNT",
        )

    def create(self, directory, deadline, prepare):
        engine, intent = self.engine, self.intent
        engine.attest(intent, deadline)
        image = engine.request("GET", f"/images/{IMAGE}/json", deadline)
        require(
            validate_image(image) == intent.image
            and not image["Config"].get("Volumes"),
            "E5A_MEDIA_IMAGE",
        )
        require(
            engine.inspect(intent.name, deadline) is None
            and self.inspect_volume(deadline) is None,
            "E5A_MEDIA_NAME_COLLISION",
        )
        write_record(
            directory,
            "media-intent.json",
            {"run": intent.run, "image": intent.image, "daemon": intent.daemon},
        )
        engine.attest(intent, deadline)
        engine.request(
            "POST",
            "/volumes/create",
            deadline,
            statuses=(201,),
            body={
                "Name": self.volume,
                "Driver": "local",
                "Labels": {LABEL: intent.run},
            },
        )
        volume = self.identity(deadline)
        require(volume is not None, "E5A_MEDIA_VOLUME_MISSING")
        write_record(directory, "media-volume.json", volume)
        prepare(volume)
        write_record(directory, "media-create.json", {"requested": True})
        engine.attest(intent, deadline)
        answer = engine.request(
            "POST",
            f"/containers/create?name={intent.name}",
            deadline,
            statuses=(201,),
            body={
                "Image": intent.image,
                "Labels": {LABEL: intent.run},
                "User": "65534:65534",
                "Entrypoint": ["/usr/local/bin/python"],
                "Cmd": ["-I", "-S", "-c", PROBE],
                "NetworkDisabled": True,
                "HostConfig": {
                    **CONFIG,
                    "Mounts": [
                        {
                            "Type": "volume",
                            "Source": self.volume,
                            "Target": "/media",
                            "VolumeOptions": {"NoCopy": True},
                        }
                    ],
                },
            },
        )
        cid = answer["Id"]
        require(HEX.fullmatch(cid), "E5A_MEDIA_CONTROLLER_ID")
        self.verify(engine.inspect(cid, deadline), cid, volume)
        write_record(directory, "media-container.json", {"id": cid})
        engine.attest(intent, deadline)
        engine.request("POST", f"/containers/{cid}/start", deadline, statuses=(204,))
        return cid

    def prepare(self, directory, host, volume, deadline):
        inspected = self.inspect_volume(deadline)
        source = volume_source(inspected, host, self.intent.run, self.volume)
        require(
            volume == {key: inspected[key] for key in ("CreatedAt", "Mountpoint")},
            "E5A_MEDIA_VOLUME_IDENTITY",
        )
        fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            meta = os.fstat(fd)
            require(
                not os.listdir(fd) and os.path.samestat(meta, source.stat()),
                "E5A_MEDIA_VOLUME_IDENTITY",
            )
            os.fchown(fd, 65534, 65534)
            os.fchmod(fd, 0o700)
            os.fsync(fd)
            write_record(
                directory, "media-data.json", {"identity": [meta.st_dev, meta.st_ino]}
            )
        finally:
            os.close(fd)

    def measurement(self, directory, deadline):
        self.engine.attest(self.intent, deadline)
        volume = self.identity(deadline)
        require(
            volume == read_record(directory, "media-volume.json"),
            "E5A_MEDIA_VOLUME_IDENTITY",
        )
        path = Path(volume["Mountpoint"])
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            meta = os.fstat(fd)
            require(
                read_record(directory, "media-data.json")
                == {"identity": [meta.st_dev, meta.st_ino]},
                "E5A_MEDIA_VOLUME_IDENTITY",
            )
            try:
                report = os.open(
                    "complete", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd
                )
            except FileNotFoundError:
                return None
            with os.fdopen(report, "rb") as stream:
                info = os.fstat(stream.fileno())
                require(
                    stat.S_ISREG(info.st_mode)
                    and info.st_uid == 65534
                    and info.st_nlink == 1
                    and 0 < info.st_size <= 96,
                    "E5A_MEDIA_REPORT",
                )
                values = stream.read(97).split(b",")
            if len(values) != 3:
                return None
            require(all(raw.isdigit() for raw in values), "E5A_MEDIA_REPORT")
            return [int(raw) for raw in values]
        finally:
            os.close(fd)

    def usage(self, directory, deadline):
        self.engine.attest(self.intent, deadline)
        volume = self.identity(deadline)
        require(
            volume == read_record(directory, "media-volume.json"),
            "E5A_MEDIA_VOLUME_IDENTITY",
        )
        fd = os.open(volume["Mountpoint"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            require(
                read_record(directory, "media-data.json")
                == {"identity": [info.st_dev, info.st_ino]},
                "E5A_MEDIA_VOLUME_IDENTITY",
            )
            names = os.listdir(fd)
            allowed = {"complete"} | {
                f"{prefix}-{index}"
                for prefix in (".stage", "file")
                for index in range(3)
            }
            require(set(names) <= allowed, "E5A_MEDIA_UNKNOWN_ENTRY")
            total = 0
            for name in names:
                state = os.stat(name, dir_fd=fd, follow_symlinks=False)
                require(
                    stat.S_ISREG(state.st_mode)
                    and state.st_uid == 65534
                    and state.st_nlink in (1, 2),
                    "E5A_MEDIA_UNKNOWN_ENTRY",
                )
                total += state.st_size
            require(total <= 1024**2, "E5A_MEDIA_WATERMARK")
            return total
        finally:
            os.close(fd)

    def recover(self, directory, deadline):
        engine, intent = self.engine, self.intent
        require(
            read_record(directory, "media-intent.json")
            == {"run": intent.run, "image": intent.image, "daemon": intent.daemon},
            "E5A_MEDIA_INTENT",
        )
        engine.attest(intent, deadline)
        volume = read_record(directory, "media-volume.json")
        observed = self.identity(deadline)
        require(observed is None or observed == volume, "E5A_MEDIA_VOLUME_IDENTITY")
        item = engine.inspect(intent.name, deadline)
        created = read_record(directory, "media-create.json", optional=True)
        record = read_record(directory, "media-container.json", optional=True)
        require(created in (None, {"requested": True}), "E5A_MEDIA_LEDGER")
        if item is not None:
            require(observed is not None and created is not None, "E5A_MEDIA_LEDGER")
            cid = item["Id"] if record is None else record["id"]
            self.verify(item, cid, volume)
            self.verify(engine.inspect(cid, deadline), cid, volume)
            if record is None:
                write_record(directory, "media-container.json", {"id": cid})
            if item["State"]["Running"]:
                engine.attest(intent, deadline)
                engine.request(
                    "POST", f"/containers/{cid}/stop?t=1", deadline, statuses=(204, 304)
                )
            engine.attest(intent, deadline)
            self.verify(engine.inspect(cid, deadline), cid, volume)
            engine.request(
                "DELETE",
                f"/containers/{cid}?v=false&force=false",
                deadline,
                statuses=(204,),
            )
            record = {"id": cid}
        require(created is None or record is not None, "E5A_MEDIA_CREATE_UNKNOWN")
        if record is not None:
            require(
                record.keys() == {"id"} and HEX.fullmatch(record["id"]),
                "E5A_MEDIA_LEDGER",
            )
            require(engine.inspect(record["id"], deadline) is None, "E5A_MEDIA_REMAINS")
        require(engine.inspect(intent.name, deadline) is None, "E5A_MEDIA_REMAINS")
        if observed is not None:
            filters = urlencode(
                {"all": 1, "filters": json.dumps({"volume": [self.volume]})}
            )
            engine.attest(intent, deadline)
            require(
                engine.request(
                    "GET", f"/containers/json?{filters}", deadline, shape=list
                )
                == [],
                "E5A_MEDIA_VOLUME_ATTACHED",
            )
            require(self.identity(deadline) == volume, "E5A_MEDIA_VOLUME_IDENTITY")
            engine.request(
                "DELETE", f"/volumes/{self.volume}", deadline, statuses=(204,)
            )
            require(self.inspect_volume(deadline) is None, "E5A_MEDIA_VOLUME_REMAINS")
