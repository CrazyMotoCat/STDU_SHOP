"""SQLite/filesystem proof on a private disposable directory.

The transaction deliberately serializes bounded local writes. Its behavior is not
evidence for PostgreSQL, target-volume power loss, or an adversarial directory owner.
"""

from contextlib import contextmanager
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import stat

CAP = 2 * 1024 * 1024
SCHEMA = """
CREATE TABLE job(id TEXT PRIMARY KEY, digest TEXT NOT NULL, size INTEGER NOT NULL, generation INTEGER NOT NULL);
CREATE TABLE intent(job TEXT NOT NULL REFERENCES job(id), generation INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('RESERVED','STAGED','COMMITTED','FENCED')),
  device TEXT, inode TEXT, PRIMARY KEY(job,generation));
"""


class StorageRefused(RuntimeError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(st):
    if not stat.S_ISREG(st.st_mode) or not st.st_ino or (
        getattr(st, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    ):
        raise StorageRefused("OBJECT_TYPE")
    return str(st.st_dev), str(st.st_ino)


class Store:
    def __init__(self, root):
        self.root = Path(root).absolute()
        self.database = self.root / "intent.sqlite3"

    @classmethod
    def initialize(cls, root):
        store = cls(root)
        store.root.mkdir(mode=0o700, exist_ok=False)
        with store.database.open("xb"):
            pass
        with store.transaction() as db:
            for statement in SCHEMA.strip().split(";"):
                if statement.strip():
                    db.execute(statement)
        store.sync_directory()
        return store

    @contextmanager
    def transaction(self, *, write=True):
        # Only initialization can create the database. A missing ledger is not an empty ledger.
        try:
            db = sqlite3.connect(
                self.database.as_uri() + "?mode=rw", uri=True, timeout=3,
            )
        except sqlite3.Error as exc:
            raise StorageRefused("STORAGE_UNAVAILABLE") from exc
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except (sqlite3.Error, OSError) as exc:
            db.rollback()
            raise StorageRefused("STORAGE_UNAVAILABLE") from exc
        finally:
            db.close()

    def sync_directory(self):
        if os.name != "posix":
            return  # explicitly outside this host's proof
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def paths(self, job, generation):
        if not re.fullmatch("[a-z0-9-]{1,48}", job) or type(generation) is not int or generation < 1:
            raise StorageRefused("IDENTITY")
        return tuple(self.root / f"{job}.g{generation}.{kind}" for kind in ("stage", "final"))

    def reserve(self, job, data):
        self.paths(job, 1)
        if not 0 < len(data) <= CAP:
            raise StorageRefused("ARTIFACT_LIMIT")
        fingerprint = digest(data), len(data)
        with self.transaction() as db:
            entry = db.execute("SELECT * FROM job WHERE id=?", (job,)).fetchone()
            if entry:
                if (entry["digest"], entry["size"]) != fingerprint:
                    raise StorageRefused("REPLAY_CONFLICT")
                return entry["generation"]
            db.execute("INSERT INTO job VALUES (?, ?, ?, 1)", (job, *fingerprint))
            db.execute("INSERT INTO intent VALUES (?,1,'RESERVED',NULL,NULL)", (job,))
        return 1

    def lookup(self, db, job, generation, *, current=True):
        row = db.execute(
            """SELECT job.digest,job.size,job.generation AS live,intent.*
               FROM intent JOIN job ON job.id=intent.job
               WHERE intent.job=? AND intent.generation=?""", (job, generation),
        ).fetchone()
        if row is None or (current and row["live"] != generation):
            raise StorageRefused("STALE_GENERATION")
        return row

    def owned_file(self, path, row):
        expected = (row["device"], row["inode"])
        if identity(path.lstat()) != expected:
            raise StorageRefused("OBJECT_OWNERSHIP")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0))
        with os.fdopen(descriptor, "rb") as handle:
            if identity(os.fstat(handle.fileno())) != expected:
                raise StorageRefused("OBJECT_OWNERSHIP")
            data = handle.read(CAP + 1)
        if len(data) != row["size"] or digest(data) != row["digest"]:
            raise StorageRefused("ARTIFACT_INTEGRITY")
        return data

    def stage(self, job, generation, data, *, checkpoint=lambda _point: None):
        stage, _ = self.paths(job, generation)
        with self.transaction() as db:
            row = self.lookup(db, job, generation)
            if (digest(data), len(data)) != (row["digest"], row["size"]):
                raise StorageRefused("ARTIFACT_INTEGRITY")
            if row["state"] != "RESERVED":
                raise StorageRefused("STAGE_EXISTS")
            with stage.open("xb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
                device, inode = identity(os.fstat(output.fileno()))
            self.sync_directory()
            checkpoint("staged")
            db.execute(
                "UPDATE intent SET state='STAGED', device=?, inode=? WHERE job=? AND generation=?",
                (device, inode, job, generation),
            )

    def finish(self, job, generation, *, checkpoint=lambda _point: None):
        stage, final = self.paths(job, generation)
        with self.transaction() as db:
            row = self.lookup(db, job, generation)
            if row["state"] == "COMMITTED":
                self.owned_file(final, row)
                return
            if row["state"] != "STAGED":
                raise StorageRefused("INTENT_NOT_STAGED")
            self.owned_file(stage, row)
            try:
                os.link(stage, final, follow_symlinks=False)
            except FileExistsError:
                pass  # only an exact inode and digest can satisfy a previous promotion
            self.owned_file(final, row)
            self.sync_directory()
            checkpoint("promoted")
            db.execute("UPDATE intent SET state='COMMITTED' WHERE job=? AND generation=?",
                       (job, generation))
        checkpoint("committed")

    def read(self, job, generation):
        _, final = self.paths(job, generation)
        with self.transaction(write=False) as db:
            row = self.lookup(db, job, generation)
            if row["state"] != "COMMITTED":
                raise StorageRefused("NOT_COMMITTED")
            return self.owned_file(final, row)

    def reconcile(self, job, generation):
        try:
            _, final = self.paths(job, generation)
            with self.transaction(write=False) as db:
                row = self.lookup(db, job, generation, current=False)
                if row["live"] != generation or row["state"] == "FENCED":
                    return "FENCED"
                if row["state"] != "COMMITTED":
                    return "NOT_COMMITTED"
                self.owned_file(final, row)
                return "COMMITTED"
        except StorageRefused:
            return "UNKNOWN"

    def takeover(self, job, generation):
        self.paths(job, generation)
        with self.transaction() as db:
            row = self.lookup(db, job, generation)
            if row["state"] == "COMMITTED":
                raise StorageRefused("ALREADY_COMMITTED")
            db.execute("UPDATE intent SET state='FENCED' WHERE job=? AND generation=?",
                       (job, generation))
            db.execute("UPDATE job SET generation=? WHERE id=?", (generation + 1, job))
            db.execute("INSERT INTO intent VALUES (?,?,'RESERVED',NULL,NULL)",
                       (job, generation + 1))
        return generation + 1

    def cleanup(self, job, generation, *, writer_stopped):
        paths = self.paths(job, generation)
        with self.transaction() as db:
            row = self.lookup(db, job, generation, current=False)
            if writer_stopped is not True:
                raise StorageRefused("WRITER_NOT_STOPPED")
            if row["state"] == "COMMITTED":
                self.owned_file(paths[1], row)
                paths = paths[:1]
            elif row["state"] != "FENCED":
                raise StorageRefused("CLEANUP_STATE")
            owned = []
            for path in paths:
                try:
                    path.lstat()
                except FileNotFoundError:
                    continue
                self.owned_file(path, row)
                owned.append(path)
            for path in owned:
                path.unlink()
            self.sync_directory()
