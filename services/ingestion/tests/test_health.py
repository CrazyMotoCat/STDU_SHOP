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
    assert response.headers["content-type"].startswith("application/json")
    assert not response.content.startswith(b'{"type":"START"')


def test_catalog_import_parser_auto_detects_quoted_csv_and_preserves_ndjson_fields() -> None:
    content = (
        b"Name;SKU;Description\r\n"
        b'Relay;RX-1;"comma, comma, comma, comma, comma, comma, comma, comma; semicolon; '
        b'escaped ""quote""\r\ncontinued"\r\n'
    )
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    assert records[0] == {"type": "START", "protocolVersion": 1, "sourceFormat": "CSV"}
    assert records[2]["cells"] == [
        {"columnIndex": 0, "cellType": "TEXT", "rawValue": "Name"},
        {"columnIndex": 1, "cellType": "TEXT", "rawValue": "SKU"},
        {"columnIndex": 2, "cellType": "TEXT", "rawValue": "Description"},
    ]
    assert records[3]["cells"][2]["rawValue"] == (
        "comma, comma, comma, comma, comma, comma, comma, comma; "
        'semicolon; escaped "quote"\r\ncontinued'
    )


def test_catalog_import_parser_uses_row_shape_when_unquoted_text_has_commas() -> None:
    content = (
        b"Name;SKU;Description\n"
        b"Relay;RX-1;pressure, 230V, indoor, assembly, IP65, terminal, panel\n"
    )
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 200
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    assert [cell["rawValue"] for cell in records[3]["cells"]] == [
        "Relay",
        "RX-1",
        "pressure, 230V, indoor, assembly, IP65, terminal, panel",
    ]


def test_catalog_import_parser_matches_unicode_whitespace_record_skipping() -> None:
    content = (
        "Name;SKU;Description\nRelay;RX-1;actual product\n"
        + '"\u2003";"\u2003";"\u2003"\n'
        + '"\u0085";"\u0085";"\u0085"\n'
        + '"\u00a0";"\u00a0";"\u00a0"\n'
    ).encode("utf-8")
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 200
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    rows = [record for record in records if record["type"] == "ROW"]
    assert len(rows) == 2
    assert [cell["rawValue"] for cell in rows[1]["cells"]] == [
        "Relay",
        "RX-1",
        "actual product",
    ]
    assert records[-1]["type"] == "COMPLETE"
    assert records[-1]["sourceParseIssues"] == []


def test_catalog_import_parser_caps_sampling_at_25_nonempty_logical_records() -> None:
    content = (
        "Name;SKU\n"
        + "".join(f"Relay {index};SKU-{index}\n" for index in range(24))
        + "".join(f"Late {index},SKU-{index}\n" for index in range(30))
    ).encode("utf-8")
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 200
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    rows = [record for record in records if record["type"] == "ROW"]
    assert len(rows) == 55
    assert [cell["rawValue"] for cell in rows[0]["cells"]] == ["Name", "SKU"]
    assert [cell["rawValue"] for cell in rows[-1]["cells"]] == ["Late 29,SKU-29"]
    assert records[-1]["type"] == "COMPLETE"
    assert records[-1]["sourceParseIssues"] == []


def test_catalog_import_parser_explicit_delimiter_overrides_auto_detection() -> None:
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b"Name;SKU\nRelay, RX-1\n",
            headers={
                "x-source-filename": "items.csv",
                "x-source-mime": "text/csv",
                "x-csv-delimiter": ";",
            },
        )
    assert response.status_code == 200
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    assert records[3]["cells"] == [
        {"columnIndex": 0, "cellType": "TEXT", "rawValue": "Relay, RX-1"}
    ]


def test_catalog_import_parser_rejects_empty_explicit_delimiter() -> None:
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b"Name;SKU\nRelay;RX-1\n",
            headers={
                "x-source-filename": "items.csv",
                "x-source-mime": "text/csv",
                "x-csv-delimiter": "",
            },
        )
    assert response.status_code == 400
    assert response.json() == {"code": "VALIDATION_ERROR"}
    assert response.headers["content-type"].startswith("application/json")


def test_catalog_import_parser_keeps_malformed_quoted_tail_as_partial_ndjson() -> None:
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=b'Name;SKU\nRelay;"unterminated',
            headers={"x-source-filename": "items.csv", "x-source-mime": "text/csv"},
        )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    records = [__import__("json").loads(line) for line in response.content.splitlines()]
    assert records[-1]["type"] == "PARTIAL"
    assert records[-1]["sourceParseIssues"][0]["code"] == "MALFORMED_CSV"


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
