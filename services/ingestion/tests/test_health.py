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
