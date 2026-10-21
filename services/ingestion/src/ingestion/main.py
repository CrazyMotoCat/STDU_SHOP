import os
from collections.abc import Callable

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse


def create_app(
    api_url: str | None = None,
    client_factory: Callable[[], httpx.AsyncClient] | None = None,
) -> FastAPI:
    app = FastAPI(title="STDU ingestion", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def ready() -> JSONResponse:
        base = api_url if api_url is not None else os.environ.get("API_INTERNAL_URL")
        factory = client_factory or (lambda: httpx.AsyncClient(timeout=5.0, trust_env=False))
        try:
            if not base:
                raise ValueError("API_INTERNAL_URL is required")
            async with factory() as client:
                response = await client.get(f"{base.rstrip('/')}/health/ready")
            if response.status_code == 200:
                return JSONResponse({"status": "ready"})
        except httpx.HTTPError, ValueError:
            pass
        return JSONResponse({"status": "not_ready"}, status_code=503)

    return app


app = create_app()
