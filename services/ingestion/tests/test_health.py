import httpx
import pytest
from fastapi.testclient import TestClient

from ingestion.main import create_app


@pytest.mark.parametrize("upstream_code,expected", [(200, 200), (503, 503), (401, 503)])
def test_readiness_tracks_api(upstream_code: int, expected: int) -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/health/ready"
        return httpx.Response(upstream_code)

    app = create_app(
        "http://api:3001",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(upstream)),
    )
    with TestClient(app) as client:
        assert client.get("/health/live").json() == {"status": "ok"}
        response = client.get("/health/ready")
        assert response.status_code == expected
        assert response.json() == {"status": "ready" if expected == 200 else "not_ready"}


def test_connection_failure_is_sanitized_and_does_not_break_liveness() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sensitive connection details", request=request)

    app = create_app(
        "http://api:3001",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(upstream)),
    )
    with TestClient(app) as client:
        response = client.get("/health/ready")
        assert response.status_code == 503
        assert "sensitive" not in response.text
        assert client.get("/health/live").status_code == 200


def test_missing_configuration_is_not_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("API_INTERNAL_URL", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/health/ready").status_code == 503


def test_catalog_import_parser_returns_versioned_csv_ndjson() -> None:
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b"Name;SKU\nRelay;00017\n",
            headers={
                "x-source-filename": "items.csv",
                "x-source-mime": "text/csv",
                "x-csv-encoding": "UTF-8",
                "x-csv-delimiter": ";",
            },
        )
    assert response.status_code == 200
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    assert [record["type"] for record in records] == ["START", "SHEET", "ROW", "ROW", "COMPLETE"]
    assert records[0] == {"type": "START", "protocolVersion": 1, "sourceFormat": "CSV"}
    assert records[3]["cells"][1]["rawValue"] == "00017"


def test_catalog_import_parser_rejects_ambiguous_csv_delimiter() -> None:
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b"Name,SKU;Price\nRelay,00017;100\n",
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 400
    assert response.json() == {"code": "ENCODING_REQUIRED"}


def test_catalog_import_parser_returns_limit_error_before_starting_ndjson(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from collections.abc import Iterator
    from typing import Any

    from ingestion import main
    from ingestion.catalog_import_parser import CsvOptions, ImportParseError

    def too_many_records(_content: bytes, _options: CsvOptions) -> Iterator[dict[str, Any]]:
        yield {"type": "START", "protocolVersion": 1, "sourceFormat": "CSV"}
        yield {"type": "SHEET", "sheetIndex": 0, "sheetName": "CSV"}
        yield {"type": "ROW", "sheetIndex": 0, "sourceRowNumber": 1, "cells": []}
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)

    monkeypatch.setattr(main, "parse_csv_records", too_many_records)
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b"Name;SKU\nRelay;1\n",
            headers={
                "x-source-filename": "items.csv",
                "x-source-mime": "text/csv",
                "x-csv-encoding": "UTF-8",
                "x-csv-delimiter": ";",
            },
        )
    assert response.status_code == 413
    assert response.json() == {"code": "IMPORT_LIMIT_EXCEEDED"}
