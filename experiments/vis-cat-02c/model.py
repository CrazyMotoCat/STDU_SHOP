"""Fault-injection reference model. In-memory state is not PostgreSQL evidence."""

import hashlib
import threading
from dataclasses import dataclass, field


class Rejected(RuntimeError):
    pass


class InjectedCrash(RuntimeError):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


@dataclass
class Intent:
    key: str
    digest: str
    size: int
    generation: int = 1
    expires: float = 240
    state: str = "WRITING"


@dataclass
class FakeDisk:
    files: dict = field(default_factory=dict)
    durable: set = field(default_factory=set)
    events: list = field(default_factory=list)

    def stage(self, key, data):
        if key in self.files:
            raise Rejected("STAGE_EXISTS")
        self.files[key] = data
        self.events.append(("write", key))

    def sync(self, key):
        if key not in self.files:
            raise Rejected("MISSING_OBJECT")
        self.durable.add(key)
        self.events.append(("file-and-directory-sync", key))

    def promote(self, stage, final):
        if final in self.files or stage not in self.durable:
            raise Rejected("PROMOTION_REFUSED")
        self.files[final] = self.files[stage]
        self.events.append(("promote", final))


class LabModel:
    def __init__(self):
        self.lock = threading.RLock()
        self.intents = {}
        self.references = {}
        self.history = []
        self.disk = FakeDisk()
        self.database_available = True
        self.now = 0.0

    def create(self, key, data):
        with self.lock:
            if not self.database_available or key in self.intents:
                raise Rejected("CREATE_REFUSED")
            if not data or len(data) > 8 * 1024**2:
                raise Rejected("INPUT_BUDGET")
            self.intents[key] = Intent(key, sha(data), len(data))
            self.history.append(("intent-commit", key, 1))
            return 1

    def paths(self, key, generation):
        return f"{key}.g{generation}.stage", f"{key}.g{generation}.final"

    def materialize(self, key, generation, data, crash=None):
        def barrier(point):
            if point == crash:
                raise InjectedCrash(point)

        with self.lock:
            intent = self.intents[key]
            if (
                intent.generation != generation
                or intent.state != "WRITING"
                or self.now >= intent.expires
            ):
                raise Rejected("STALE_WRITER")
            if sha(data) != intent.digest or len(data) != intent.size:
                raise Rejected("SOURCE_MISMATCH")
        stage, final = self.paths(key, generation)
        barrier("before-write")
        self.disk.stage(stage, data)
        barrier("after-write")
        self.disk.sync(stage)
        barrier("after-stage-sync")
        self.disk.promote(stage, final)
        barrier("after-promote")
        self.disk.sync(final)
        barrier("after-final-sync")
        return final

    def commit(self, key, generation, crash=None):
        with self.lock:
            if not self.database_available:
                raise Rejected("DATABASE_UNAVAILABLE")
            intent = self.intents[key]
            stage, final = self.paths(key, generation)
            if intent.generation != generation:
                raise Rejected("STALE_GENERATION")
            if intent.state == "COMMITTED":
                if self.references.get(key) == final:
                    self.validate_reference(key)
                    self.disk.files.pop(stage, None)
                    self.disk.durable.discard(stage)
                    return final
                raise Rejected("REPLAY_CONFLICT")
            if intent.state != "WRITING" or self.now >= intent.expires:
                raise Rejected("LEASE_EXPIRED_OR_FENCED")
            data = self.disk.files.get(final)
            if (
                data is None
                or final not in self.disk.durable
                or sha(data) != intent.digest
                or len(data) != intent.size
            ):
                raise Rejected("UNVERIFIED_FINAL")
            if crash == "before-commit":
                raise InjectedCrash(crash)
            self.references[key] = final
            intent.state = "COMMITTED"
            self.history.append(("reference-commit", key, generation))
            if crash == "after-commit":
                raise InjectedCrash(crash)
            # Stage cleanup belongs to this committed generation only.
            self.disk.files.pop(stage, None)
            self.disk.durable.discard(stage)
            return final

    def fence(self, key, generation):
        with self.lock:
            if not self.database_available:
                raise Rejected("DATABASE_UNAVAILABLE")
            intent = self.intents[key]
            if intent.generation != generation or intent.state != "WRITING":
                raise Rejected("FENCE_CONFLICT")
            intent.generation += 1
            intent.state = "FENCED"
            self.history.append(("fence-commit", key, generation))
            return generation + 1

    def reconcile(self, key, old_generation, stopped_writers):
        with self.lock:
            if not self.database_available:
                raise Rejected("DATABASE_UNAVAILABLE")
            intent = self.intents[key]
            if (
                intent.state != "FENCED"
                or intent.generation <= old_generation
                or (key, old_generation) not in stopped_writers
            ):
                raise Rejected("QUIESCENCE_UNCONFIRMED")
            owned = self.paths(key, old_generation)
            if any(path in self.references.values() for path in owned):
                raise Rejected("REGISTERED_OBJECT")
            for path in owned:
                self.disk.files.pop(path, None)
                self.disk.durable.discard(path)
            self.history.append(("cleanup", key, old_generation))
            return owned

    def validate_reference(self, key):
        with self.lock:
            path = self.references[key]
            data = self.disk.files.get(path)
            intent = self.intents[key]
            if data is None or sha(data) != intent.digest or len(data) != intent.size:
                raise Rejected("EXTERNAL_CORRUPTION")
            return data
