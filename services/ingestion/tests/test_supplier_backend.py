import base64
import json
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from ingestion import supplier_backend as backend
from ingestion.main import create_app
from ingestion.supplier_ingestion import digest
from ingestion.supplier_models import MAX_BYTES

PATH = "/internal/v1/supplier-ingestion/extract"
TOKEN = "TEST-supplier-extraction-token-0123456789"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}


def command(**changes: object) -> dict[str, object]:
    return {
        "protocol": "r1-008b.mock.v1",
        "run_id": str(uuid4()),
        "adapter_version": "fixture-json/1",
        "fixture_key": "offers-v1",
        "raw_snapshot": None,
    } | changes


@pytest.fixture(autouse=True)
def configured_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPPLIER_INGESTION_TOKEN", TOKEN)


def test_extracts_fixed_fixture_with_original_snapshot_and_deterministic_results() -> None:
    payload = command()
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=payload, headers=HEADERS)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        result = response.json()
        assert set(result) == {
            "protocol",
            "run_id",
            "adapter_version",
            "source_hash",
            "raw_snapshot",
            "results",
        }
        assert result["run_id"] == payload["run_id"]
        raw = base64.b64decode(result["raw_snapshot"], validate=True)
        assert raw == backend.FIXTURES["offers-v1"].read_bytes()
        assert result["source_hash"] == digest(raw)
        assert len(result["results"]) == 2
        first, second = result["results"]
        assert first["normalized"]["purchase_cost"] == "1250"
        assert first["normalized"]["currency"] == "RUB"
        assert second["normalized"]["purchase_cost"] is None
        assert second["normalized"]["currency"] is None
        assert second["modification_evidence"] == "UNKNOWN"
        assert all(row["identity_status"] == "UNVERIFIED" for row in result["results"])
        assert client.post(PATH, json=payload, headers=HEADERS).json() == result


def test_mixed_source_preserves_valid_candidates_and_explicit_row_errors() -> None:
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(fixture_key="mixed-v1"), headers=HEADERS)
    assert response.status_code == 200
    rows = response.json()["results"]
    assert len(rows) == 3
    assert rows[1] == {"row_number": 2, "code": "ROW_INVALID"}
    assert rows[0]["row_number"] == 1 and rows[2]["row_number"] == 3


def test_captured_snapshot_replays_after_fixture_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = command()
    with TestClient(create_app()) as client:
        original = client.post(PATH, json=payload, headers=HEADERS).json()
        changed = tmp_path / "changed.json"
        changed.write_text('[{"offer_name":"TEST changed"}]')
        monkeypatch.setitem(backend.FIXTURES, "offers-v1", changed)
        replay = client.post(
            PATH, json=payload | {"raw_snapshot": original["raw_snapshot"]}, headers=HEADERS
        )
        assert replay.status_code == 200 and replay.json() == original


@pytest.mark.parametrize("token", [None, "short"])
def test_missing_server_secret_disables_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    token: str | None,
) -> None:
    if token is None:
        monkeypatch.delenv("SUPPLIER_INGESTION_TOKEN")
    else:
        monkeypatch.setenv("SUPPLIER_INGESTION_TOKEN", token)
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(), headers=HEADERS)
    assert response.status_code == 503
    assert response.json() == {"code": "EXTRACTION_UNAVAILABLE"}


@pytest.mark.parametrize("auth", [None, "Bearer wrong", "Basic TEST", TOKEN])
def test_unauthorized_requests_fail_before_parsing(auth: str | None) -> None:
    headers = {"Authorization": auth} if auth is not None else {}
    with TestClient(create_app()) as client:
        response = client.post(PATH, content=b"invalid payload", headers=headers)
    assert response.status_code == 401 and response.json() == {"code": "AUTH_REQUIRED"}


@pytest.mark.parametrize(
    "changes",
    [
        {"fixture_key": "../../private"},
        {"fixture_key": "https://supplier.example"},
        {"adapter_version": "python-script/1"},
        {"run_id": "not-a-uuid"},
        {"protocol": "r1-008a.mock.v1"},
        {"actor_id": str(uuid4())},
        {"publish": True},
        {"url": "http://127.0.0.1"},
        {"path": "/etc/passwd"},
        {"raw_snapshot": 123},
    ],
)
def test_command_rejects_authority_paths_and_unsupported_protocol(
    changes: dict[str, object],
) -> None:
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(**changes), headers=HEADERS)
    assert response.status_code == 400 and response.json() == {"code": "REQUEST_INVALID"}


@pytest.mark.parametrize(
    "raw", [b"not JSON", b"[] []", b"{}", b"[NaN]", b"[{}]" * 101, json.dumps([{}] * 101).encode()]
)
def test_malformed_or_excessive_source_envelope_is_rejected(raw: bytes) -> None:
    with TestClient(create_app()) as client:
        response = client.post(
            PATH, json=command(raw_snapshot=base64.b64encode(raw).decode()), headers=HEADERS
        )
    assert response.status_code == 422 and response.json() == {"code": "SOURCE_INVALID"}


@pytest.mark.parametrize("raw_snapshot", ["%%%", "e30=\n", "e31=", "\u2603"])
def test_invalid_or_noncanonical_base64_is_rejected(raw_snapshot: str) -> None:
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(raw_snapshot=raw_snapshot), headers=HEADERS)
    assert response.status_code == 422 and response.json() == {"code": "SNAPSHOT_INVALID"}


def test_raw_bytes_limit_is_enforced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    huge = tmp_path / "huge.json"
    huge.write_bytes(b" " * (MAX_BYTES + 1))
    monkeypatch.setitem(backend.FIXTURES, "offers-v1", huge)
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(), headers=HEADERS)
    assert response.status_code == 413
    assert response.json() == {"code": "INPUT_LIMIT_EXCEEDED"}


def test_request_limit_applies_without_content_length() -> None:
    def chunks() -> Iterator[bytes]:
        yield b" " * backend.MAX_REQUEST_BYTES
        yield b"x"

    with TestClient(create_app()) as client:
        response = client.post(PATH, content=chunks(), headers=HEADERS)
    assert response.status_code == 413


def test_duplicate_json_fields_and_wrong_media_type_are_rejected() -> None:
    with TestClient(create_app()) as client:
        response = client.post(PATH, content=b'{"protocol":"a","protocol":"b"}', headers=HEADERS)
        assert response.status_code == 400
        response = client.post(PATH, content=b"{}", headers={"Authorization": f"Bearer {TOKEN}"})
        assert response.status_code == 415


def test_source_failure_is_sanitized(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(backend.FIXTURES, "offers-v1", tmp_path / "secret-storage-location")
    with TestClient(create_app()) as client:
        response = client.post(PATH, json=command(), headers=HEADERS)
    assert response.status_code == 503 and response.json() == {"code": "SOURCE_UNAVAILABLE"}


def test_health_and_existing_catalog_parse_route_remain_available() -> None:
    with TestClient(create_app()) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        assert client.post("/internal/v1/catalog-import/parse", content=b"").status_code == 415
