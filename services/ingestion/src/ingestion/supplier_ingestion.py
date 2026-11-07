"""Manual fixture-only extraction. No HTTP client, business credentials, queue or publisher."""

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import BinaryIO, Literal, Never

from pydantic import ValidationError

from ingestion.supplier_models import (
    MAX_BYTES,
    MAX_ROWS,
    Candidate,
    Event,
    Job,
    Manifest,
    OfferInput,
    RowError,
    Run,
)


class IngestionError(Exception):
    """Safe diagnostic code only. Source values and exception text never reach CLI output."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class Source:
    source_id: str
    version: str
    supplier_reference: str
    fixture: Path
    enabled: bool = True
    adapter_version: str = "fixture-json/1"


SOURCES = (
    Source(
        "TEST-synthetic-offers",
        "1",
        "TEST-supplier-not-a-business-id",
        Path(__file__).parent / "fixtures" / "supplier-offers.json",
    ),
)


def read_bounded(path: Path, limit: int = MAX_BYTES) -> bytes:
    if path.is_symlink():
        raise IngestionError("UNSAFE_PATH")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise IngestionError("INPUT_LIMIT_EXCEEDED")
    return data


def atomic_write(path: Path, data: bytes) -> None:
    """Commit one checkpoint, not a database transaction or power-loss guarantee."""
    if path.is_symlink():
        raise IngestionError("UNSAFE_PATH")
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def lock_file(stream: BinaryIO, unlock: bool = False) -> None:
    if sys.platform == "win32":
        import msvcrt

        stream.seek(0)
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK if unlock else msvcrt.LK_NBLCK, 1)
    else:
        import fcntl

        fcntl.flock(stream.fileno(), fcntl.LOCK_UN if unlock else fcntl.LOCK_EX | fcntl.LOCK_NB)


@contextmanager
def exclusive(directory: Path) -> Iterator[None]:
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if directory.is_symlink():
        raise IngestionError("UNSAFE_PATH")
    path = directory / ".lock"
    if path.is_symlink():
        raise IngestionError("UNSAFE_PATH")
    with path.open("a+b") as stream:
        if path.stat().st_size == 0:
            stream.write(b"0")
            stream.flush()
        try:
            lock_file(stream)
        except OSError:
            raise IngestionError("JOB_BUSY") from None
        try:
            yield
        finally:
            lock_file(stream, unlock=True)


def encode(run: Run) -> bytes:
    return run.model_dump_json(indent=2).encode()


def unique_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def reject_constant(value: str) -> Never:
    raise ValueError("non-finite number")


def finish(run: Run) -> None:
    run.finished_at = now()
    run.duration_ms = max(
        0,
        int(
            (
                datetime.fromisoformat(run.finished_at) - datetime.fromisoformat(run.started_at)
            ).total_seconds()
            * 1000
        ),
    )


def execute(
    job: Job,
    workspace: Path,
    sources: tuple[Source, ...] = SOURCES,
    after_checkpoint: Callable[[int], None] | None = None,
) -> Run:
    """Repeat same job to resume extraction; terminal results replay without mutation.

    `sources` and `after_checkpoint` are in-process test dependencies, not job fields.
    Workspace must be private/trusted local test storage. No production storage adapter.
    """
    if os.environ.get("APP_ENV", "test") not in {"test", "local", "development"}:
        raise IngestionError("MOCK_PROFILE_ONLY")
    deadline = time.monotonic() + 10
    source = next((s for s in sources if s.source_id == job.source_id), None)
    if source is None or not source.enabled or source.adapter_version != "fixture-json/1":
        raise IngestionError("SOURCE_NOT_ALLOWED")
    fingerprint = digest(
        json.dumps(
            {
                "job": job.model_dump(mode="json"),
                "source_version": source.version,
                "adapter_version": source.adapter_version,
                "supplier_reference": source.supplier_reference,
            },
            sort_keys=True,
        ).encode()
    )
    directory = workspace / str(job.job_id)
    try:
        with exclusive(directory):
            state_path, raw_path = directory / "run.json", directory / "source.json"
            manifest_path = directory / "manifest.json"
            if state_path.exists():
                try:
                    run = Run.model_validate_json(read_bounded(state_path, 2 * MAX_BYTES))
                    manifest = Manifest.model_validate_json(read_bounded(manifest_path, 4096))
                except ValidationError:
                    raise IngestionError("CHECKPOINT_INVALID") from None
                if (
                    run.request_fingerprint != fingerprint
                    or manifest.request_fingerprint != fingerprint
                ):
                    raise IngestionError("JOB_ID_CONFLICT")
                raw = read_bounded(raw_path)
                if digest(raw) != run.raw_sha256 or digest(raw) != manifest.raw_sha256:
                    raise IngestionError("SOURCE_INTEGRITY_ERROR")
                if (
                    run.job != job
                    or run.source_version != source.version
                    or run.adapter_version != source.adapter_version
                    or run.supplier_reference != source.supplier_reference
                ):
                    raise IngestionError("CHECKPOINT_INVALID")
                if run.status != "RUNNING":
                    if run.status in {"COMPLETE", "PARTIAL"}:
                        try:
                            rows = json.loads(
                                raw, object_pairs_hook=unique_keys, parse_constant=reject_constant
                            )
                            if not isinstance(rows, list) or len(rows) != run.processed:
                                raise ValueError
                        except ValueError, RecursionError, UnicodeError:
                            raise IngestionError("CHECKPOINT_INVALID") from None
                    return run
                if run.attempts >= 5:
                    raise IngestionError("ATTEMPT_LIMIT_EXCEEDED")
                run.attempts += 1
                run.events.append(Event(code="RESUMED", at=now()))
            else:
                # Bind identity before snapshot/state; never replace interrupted input.
                raw = read_bounded(source.fixture)
                manifest = Manifest(request_fingerprint=fingerprint, raw_sha256=digest(raw))
                if manifest_path.exists():
                    try:
                        saved = Manifest.model_validate_json(read_bounded(manifest_path, 4096))
                    except ValidationError:
                        raise IngestionError("CHECKPOINT_INVALID") from None
                    if saved.request_fingerprint != fingerprint:
                        raise IngestionError("JOB_ID_CONFLICT")
                    if saved.raw_sha256 != digest(raw):
                        raise IngestionError("SOURCE_INTEGRITY_ERROR")
                else:
                    atomic_write(manifest_path, manifest.model_dump_json().encode())
                if raw_path.exists():
                    if read_bounded(raw_path) != raw:
                        raise IngestionError("SOURCE_INTEGRITY_ERROR")
                else:
                    atomic_write(raw_path, raw)
                run = Run(
                    job=job,
                    source_version=source.version,
                    adapter_version=source.adapter_version,
                    supplier_reference=source.supplier_reference,
                    request_fingerprint=fingerprint,
                    raw_sha256=digest(raw),
                    started_at=now(),
                    events=[Event(code="STARTED", at=now())],
                )
            atomic_write(state_path, encode(run))
            try:
                rows = json.loads(
                    raw, object_pairs_hook=unique_keys, parse_constant=reject_constant
                )
                if not isinstance(rows, list):
                    raise ValueError
                if len(rows) > MAX_ROWS:
                    raise ValueError
            except ValueError, RecursionError, UnicodeError:
                run.status = "FAILED"
                finish(run)
                run.events.append(Event(code="INPUT_INVALID", at=now()))
                atomic_write(state_path, encode(run))
                return run
            for index in range(run.processed, len(rows)):
                if time.monotonic() > deadline:
                    run.events.append(Event(code="TIME_LIMIT", at=now()))
                    atomic_write(state_path, encode(run))
                    raise IngestionError("TIME_LIMIT_EXCEEDED")
                row_number = index + 1
                event: Literal["ROW_STAGED", "ROW_INVALID"]
                try:
                    value = OfferInput.model_validate(rows[index])
                    warnings = ["IDENTITY_UNVERIFIED", "NOT_A_BUSINESS_OFFER"]
                    if value.purchase_cost is None:
                        warnings.append("PRICE_UNKNOWN")
                    candidate = Candidate(
                        candidate_id=digest(
                            f"{job.job_id}:{run.raw_sha256}:{source.adapter_version}:{row_number}".encode()
                        ),
                        row_number=row_number,
                        normalized=value,
                        modification_evidence="SPECIFIED" if value.modification else "UNKNOWN",
                        warnings=warnings,
                    )
                    run.candidates.append(candidate)
                    event = "ROW_STAGED"
                except ValidationError:
                    run.errors.append(RowError(row_number=row_number))
                    event = "ROW_INVALID"
                run.processed = row_number
                run.events.append(Event(code=event, at=now(), row_number=row_number))
                atomic_write(state_path, encode(run))
                if after_checkpoint:
                    after_checkpoint(row_number)
            run.status = "PARTIAL" if run.errors else "COMPLETE"
            finish(run)
            run.events.append(Event(code=run.status, at=now()))
            atomic_write(state_path, encode(run))
            return run
    except OSError:
        raise IngestionError("STORAGE_UNAVAILABLE") from None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Manual TEST fixture extraction; no business writes"
    )
    parser.add_argument("--mock-only", action="store_true", required=True)
    parser.add_argument("--job", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args()
    try:
        raw_job = json.loads(
            read_bounded(args.job, 4096),
            object_pairs_hook=unique_keys,
            parse_constant=reject_constant,
        )
        job = Job.model_validate_json(json.dumps(raw_job))
        run = execute(job, args.workspace)
        print(
            json.dumps(
                {
                    "job_id": str(job.job_id),
                    "status": run.status,
                    "candidates": len(run.candidates),
                    "errors": len(run.errors),
                }
            )
        )
        return 0 if run.status == "COMPLETE" else 2
    except ValidationError, ValueError, OSError, RecursionError:
        print(json.dumps({"code": "JOB_INVALID"}))
        return 3
    except IngestionError as error:
        print(json.dumps({"code": str(error)}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
