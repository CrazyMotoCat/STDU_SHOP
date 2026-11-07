import json
import socket
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from typing import NoReturn
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from ingestion import supplier_ingestion as runner
from ingestion.main import create_app
from ingestion.supplier_ingestion import IngestionError, Source, execute
from ingestion.supplier_models import MAX_BYTES, Job, OfferInput


def job(source_id: str = "TEST-synthetic-offers") -> Job:
    return Job.model_validate_json(
        json.dumps(
            {
                "contract_version": "r1-008a.mock.v1",
                "profile": "mock-only",
                "job_id": str(uuid4()),
                "source_id": source_id,
            }
        )
    )


def fixture(tmp_path: Path, raw: bytes) -> Source:
    file = tmp_path / "fixture.json"
    file.write_bytes(raw)
    return Source("TEST-synthetic-offers", "1", "TEST-supplier", file)


@pytest.fixture(autouse=True)
def test_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "test")


def test_manual_run_provenance_missing_facts_and_replay(tmp_path: Path) -> None:
    request = job()
    run = execute(request, tmp_path)
    assert run.status == "COMPLETE" and len(run.candidates) == 2
    assert run.duration_ms is not None and run.duration_ms >= 0
    assert run.candidates[0].normalized.purchase_cost == "1250"
    missing = run.candidates[1]
    assert missing.normalized.currency is None
    assert missing.normalized.purchase_cost is None
    assert missing.normalized.source_vat_text is None
    assert missing.normalized.availability_text is None
    assert missing.normalized.lead_time_text is None
    assert missing.normalized.source_observed_at is None
    assert missing.modification_evidence == "UNKNOWN"
    assert all(c.identity_status == "UNVERIFIED" for c in run.candidates)
    directory = tmp_path / str(request.job_id)
    raw = (directory / "source.json").read_bytes()
    assert raw == runner.SOURCES[0].fixture.read_bytes()
    assert run.raw_sha256 == runner.digest(raw)
    assert run.supplier_reference == "TEST-supplier-not-a-business-id"
    assert [c.row_number for c in run.candidates] == [1, 2]
    saved = (directory / "run.json").read_bytes()
    assert execute(request, tmp_path) == run
    assert (directory / "run.json").read_bytes() == saved


@pytest.mark.parametrize(
    "change",
    [
        {"source_id": "https://supplier.example"},
        {"source_id": "../secret"},
        {"job_id": "../escape"},
        {"profile": "production"},
        {"contract_version": "v2"},
        {"url": "http://127.0.0.1"},
        {"publish": True},
        {"staff_user_id": str(uuid4())},
    ],
)
def test_job_schema_cannot_select_paths_network_or_authority(change: dict[str, object]) -> None:
    payload = job().model_dump(mode="json") | change
    with pytest.raises(ValidationError):
        Job.model_validate_json(json.dumps(payload))


def test_registry_disabled_unknown_and_source_identity_conflict(tmp_path: Path) -> None:
    request = job()
    with pytest.raises(IngestionError, match="SOURCE_NOT_ALLOWED"):
        execute(job("TEST-unknown"), tmp_path)
    source = runner.SOURCES[0]
    with pytest.raises(IngestionError, match="SOURCE_NOT_ALLOWED"):
        execute(request, tmp_path, (replace(source, enabled=False),))
    with pytest.raises(IngestionError, match="SOURCE_NOT_ALLOWED"):
        execute(request, tmp_path, (replace(source, adapter_version="http/1"),))
    execute(request, tmp_path)
    for changed in [replace(source, version="2"), replace(source, supplier_reference="TEST-other")]:
        with pytest.raises(IngestionError, match="JOB_ID_CONFLICT"):
            execute(request, tmp_path, (changed,))


@pytest.mark.parametrize(
    "bad",
    [
        {"purchase_cost": 1.5},
        {"purchase_cost": "1.25"},
        {"purchase_cost": "NaN"},
        {"purchase_cost": "-1", "currency": "RUB"},
        {"currency": "XYZ"},
        {"modification": "A\nB"},
        {"offer_name": "x" * 241},
        {"offer_name": "\ud800"},
        {"brand_id": str(uuid4())},
        {"source_observed_at": "2026-11-07T00:00:00"},
        {"source_url": "http://127.0.0.1/private"},
    ],
)
def test_invalid_row_is_partial_not_success(tmp_path: Path, bad: dict[str, object]) -> None:
    rows = [{"offer_name": "TEST valid"}, {"offer_name": "TEST invalid"} | bad]
    source = fixture(tmp_path, json.dumps(rows).encode())
    request = job()
    run = execute(request, tmp_path / "runs", (source,))
    assert run.status == "PARTIAL" and run.processed == 2
    assert len(run.candidates) == 1 and run.errors[0].row_number == 2
    assert run.errors[0].code == "ROW_INVALID"
    assert execute(request, tmp_path / "runs", (source,)) == run


def test_exact_text_and_decimal_normalization() -> None:
    value = OfferInput(
        offer_name=" TEST ",
        manufacturer_name=" Cafe\u0301  Ltd ",
        original_part_number=" 00-a-A ",
        purchase_cost="0.010000",
        currency="RUB",
    )
    assert value.manufacturer_name == "Café  Ltd"
    assert value.original_part_number == "00-a-A"
    assert value.purchase_cost == "0.01"
    assert value.modification is None
    with pytest.raises(ValidationError):
        OfferInput()


@pytest.mark.parametrize("length,expected", [(120, "COMPLETE"), (240, "PARTIAL")])
def test_unicode_expansion_is_bounded_and_replayable(
    tmp_path: Path,
    length: int,
    expected: str,
) -> None:
    # NFC expands this canonically excluded character to two codepoints.
    source = fixture(tmp_path, json.dumps([{"offer_name": "\u0958" * length}]).encode())
    request = job()
    run = execute(request, tmp_path / "runs", (source,))
    assert run.status == expected
    if expected == "COMPLETE":
        assert len(run.candidates[0].normalized.offer_name or "") == 240
    else:
        assert run.errors[0].code == "ROW_INVALID" and not run.candidates
    assert execute(request, tmp_path / "runs", (source,)) == run


@pytest.mark.parametrize(
    "raw",
    [
        b"{}",
        b"[",
        b"[NaN]",
        b'[ {"offer_name":"a","offer_name":"b"}]',
        b"[{}]" * 101,
        json.dumps([{}] * 101).encode(),
    ],
)
def test_invalid_envelope_is_failed_and_replayed(tmp_path: Path, raw: bytes) -> None:
    source = fixture(tmp_path, raw)
    request = job()
    run = execute(request, tmp_path / "runs", (source,))
    assert run.status == "FAILED" and not run.candidates
    assert run.events[-1].code == "INPUT_INVALID"
    assert execute(request, tmp_path / "runs", (source,)) == run


def test_source_byte_cap_and_safe_io_failure(tmp_path: Path) -> None:
    source = fixture(tmp_path, b"x" * (MAX_BYTES + 1))
    with pytest.raises(IngestionError, match="INPUT_LIMIT_EXCEEDED"):
        execute(job(), tmp_path / "runs", (source,))
    with pytest.raises(IngestionError, match="STORAGE_UNAVAILABLE"):
        execute(job(), tmp_path / "runs", (replace(source, fixture=tmp_path / "secret-missing"),))


def test_time_budget_preserves_resumable_checkpoint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = job()
    times = iter([0.0, 11.0])
    with monkeypatch.context() as patch:
        patch.setattr("ingestion.supplier_ingestion.time.monotonic", lambda: next(times))
        with pytest.raises(IngestionError, match="TIME_LIMIT_EXCEEDED"):
            execute(request, tmp_path)
    state = json.loads((tmp_path / str(request.job_id) / "run.json").read_bytes())
    assert state["processed"] == 0 and state["events"][-1]["code"] == "TIME_LIMIT"
    assert execute(request, tmp_path).status == "COMPLETE"


def test_partial_checkpoint_failure_resumes_without_duplicates(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = job()
    original = runner.atomic_write

    def fail_write(path: Path, data: bytes) -> None:
        if path.name == "run.json" and json.loads(data)["processed"] == 2:
            raise OSError("secret infrastructure details")
        original(path, data)

    monkeypatch.setattr(runner, "atomic_write", fail_write)
    with pytest.raises(IngestionError, match="STORAGE_UNAVAILABLE"):
        execute(request, tmp_path)
    state = json.loads((tmp_path / str(request.job_id) / "run.json").read_bytes())
    assert state["processed"] == 1
    first_id = state["candidates"][0]["candidate_id"]
    monkeypatch.setattr(runner, "atomic_write", original)
    resumed = execute(request, tmp_path)
    assert resumed.status == "COMPLETE" and resumed.attempts == 2
    assert resumed.candidates[0].candidate_id == first_id
    assert len({c.candidate_id for c in resumed.candidates}) == 2
    assert any(e.code == "RESUMED" for e in resumed.events)


@pytest.mark.parametrize("fail_at", ["source.json", "run.json"])
def test_initial_write_interruption_binds_source_and_recovers(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fail_at: str,
) -> None:
    request = job()
    original = runner.atomic_write

    def fail_write(path: Path, data: bytes) -> None:
        if path.name == fail_at:
            raise OSError("simulated interruption")
        original(path, data)

    monkeypatch.setattr(runner, "atomic_write", fail_write)
    with pytest.raises(IngestionError, match="STORAGE_UNAVAILABLE"):
        execute(request, tmp_path)
    monkeypatch.setattr(runner, "atomic_write", original)
    with pytest.raises(IngestionError, match="JOB_ID_CONFLICT"):
        execute(request, tmp_path, (replace(runner.SOURCES[0], version="2"),))
    assert execute(request, tmp_path).status == "COMPLETE"


def test_abrupt_process_exit_releases_lock_and_recovers(tmp_path: Path) -> None:
    request = job()
    code = """
import os,sys
from pathlib import Path
from ingestion.supplier_models import Job
from ingestion.supplier_ingestion import execute
execute(Job.model_validate_json(sys.argv[1]),Path(sys.argv[2]),
        after_checkpoint=lambda _:os._exit(91))
"""
    result = subprocess.run(
        [sys.executable, "-c", code, request.model_dump_json(), str(tmp_path)],
        capture_output=True,
        timeout=15,
        check=False,
    )
    assert result.returncode == 91
    resumed = execute(request, tmp_path)
    assert resumed.status == "COMPLETE" and resumed.attempts == 2
    assert len(resumed.candidates) == 2


def test_exclusive_lock_and_attempt_bound(tmp_path: Path) -> None:
    request = job()
    with runner.exclusive(tmp_path / str(request.job_id)):
        with pytest.raises(IngestionError, match="JOB_BUSY"):
            execute(request, tmp_path)

    def interrupt(_: int) -> NoReturn:
        raise KeyboardInterrupt

    # Two rows are insufficient for five resumptions: interrupt after the first
    # checkpoint, then emulate repeated pre-processing storage failures separately.
    with pytest.raises(KeyboardInterrupt):
        execute(request, tmp_path, after_checkpoint=interrupt)
    file = tmp_path / str(request.job_id) / "run.json"
    state = json.loads(file.read_bytes())
    state["attempts"] = 5
    file.write_text(json.dumps(state))
    with pytest.raises(IngestionError, match="ATTEMPT_LIMIT_EXCEEDED"):
        execute(request, tmp_path)


def test_corrupt_raw_or_checkpoint_never_overwrites_evidence(tmp_path: Path) -> None:
    request = job()
    execute(request, tmp_path)
    raw = tmp_path / str(request.job_id) / "source.json"
    raw.write_bytes(b"corrupted TEST evidence")
    with pytest.raises(IngestionError, match="SOURCE_INTEGRITY_ERROR"):
        execute(request, tmp_path)
    assert raw.read_bytes() == b"corrupted TEST evidence"
    file = raw.with_name("run.json")
    file.write_text("{}")
    with pytest.raises(IngestionError, match="CHECKPOINT_INVALID"):
        execute(request, tmp_path)


@pytest.mark.parametrize("change", ["coordinate", "source", "count"])
def test_checkpoint_logical_provenance_consistency(tmp_path: Path, change: str) -> None:
    request = job()
    execute(request, tmp_path)
    file = tmp_path / str(request.job_id) / "run.json"
    state = json.loads(file.read_bytes())
    if change == "coordinate":
        state["candidates"][0]["row_number"] = 2
    elif change == "source":
        state["supplier_reference"] = "TEST-other"
    else:
        state["processed"] = 1
        state["candidates"] = state["candidates"][:1]
    file.write_text(json.dumps(state))
    with pytest.raises(IngestionError, match="CHECKPOINT_INVALID"):
        execute(request, tmp_path)


def test_no_network_business_credentials_or_http_endpoint(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*args: object, **kwargs: object) -> NoReturn:
        raise AssertionError("network/business connection attempted")

    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(httpx.Client, "request", forbidden)
    monkeypatch.setattr(httpx.AsyncClient, "request", forbidden)
    monkeypatch.setenv("DATABASE_URL", "invalid://TEST-no-business-connection")
    monkeypatch.setenv("REDIS_URL", "invalid://TEST-no-queue")
    assert execute(job(), tmp_path).status == "COMPLETE"
    # No supplier operation was exposed through the existing ingestion service.
    app = create_app()
    assert all(
        getattr(route, "path", "") != "/internal/v1/supplier-ingestion" for route in app.routes
    )


def test_mock_profile_disabled_in_production(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(IngestionError, match="MOCK_PROFILE_ONLY"):
        execute(job(), tmp_path)
    assert not list(tmp_path.iterdir())


def test_cli_manual_run_replay_and_safe_diagnostics(tmp_path: Path) -> None:
    request = job()
    file = tmp_path / "job.json"
    file.write_text(request.model_dump_json())
    command = [
        sys.executable,
        "-m",
        "ingestion.supplier_ingestion",
        "--mock-only",
        "--job",
        str(file),
        "--workspace",
        str(tmp_path / "runs"),
    ]
    for _ in range(2):
        result = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
        assert result.returncode == 0
        assert json.loads(result.stdout)["candidates"] == 2
        assert "TEST-CTRL" not in result.stdout and result.stderr == ""
    file.write_text('{"secret":"do not leak"}')
    result = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
    assert result.returncode == 3 and json.loads(result.stdout) == {"code": "JOB_INVALID"}
    assert "secret" not in result.stdout and not result.stderr


def test_existing_http_parser_surface_unchanged() -> None:
    with TestClient(create_app()) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert (
            client.post("/internal/v1/supplier-ingestion", json={"publish": True}).status_code
            == 404
        )
