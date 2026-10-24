import os
from collections.abc import AsyncIterator, Callable

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.responses import Response

from ingestion.catalog_import_parser import (
    MAX_FILE_BYTES,
    CsvOptions,
    ImportParseError,
    _line,
    parse_csv_records,
    parse_xlsx_records,
)


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

    @app.post("/internal/v1/catalog-import/parse")
    async def parse_catalog_import(request: Request) -> Response:
        filename = request.headers.get("x-source-filename", "")
        declared_mime = request.headers.get("x-source-mime", "").lower()
        extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if (
            not filename
            or len(filename) > 255
            or any(character in filename for character in ("/", "\\", "\x00"))
            or any(ord(character) < 32 for character in filename)
        ):
            return JSONResponse({"code": "FILE_REJECTED"}, status_code=415)
        content_length = request.headers.get("content-length")
        if content_length and content_length.isdecimal() and int(content_length) > MAX_FILE_BYTES:
            return JSONResponse({"code": "FILE_TOO_LARGE"}, status_code=413)
        body = await request.body()
        if not body:
            return JSONResponse({"code": "FILE_REJECTED"}, status_code=415)
        if len(body) > MAX_FILE_BYTES:
            return JSONResponse({"code": "FILE_TOO_LARGE"}, status_code=413)
        try:
            if extension == "csv" and declared_mime in {
                "text/csv",
                "application/csv",
                "text/plain",
                "application/octet-stream",
            }:
                encoding = request.headers.get("x-csv-encoding")
                delimiter = request.headers.get("x-csv-delimiter")
                records = parse_csv_records(body, CsvOptions(encoding, delimiter))
            elif extension == "xlsx" and declared_mime in {
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/octet-stream",
            }:
                if request.headers.get("x-csv-encoding") or request.headers.get("x-csv-delimiter"):
                    return JSONResponse({"code": "VALIDATION_ERROR"}, status_code=400)
                records = parse_xlsx_records(body)
            else:
                return JSONResponse({"code": "UNSUPPORTED_MEDIA_TYPE"}, status_code=415)
            first = next(records)
            if first.get("type") != "START":
                return JSONResponse({"code": "FILE_REJECTED"}, status_code=415)
            _line(first)
            for record in records:
                _line(record)
        except ImportParseError as error:
            return JSONResponse({"code": error.code}, status_code=error.status_code)
        except StopIteration, UnicodeError, ValueError:
            return JSONResponse({"code": "FILE_REJECTED"}, status_code=415)

        try:
            records = (
                parse_csv_records(
                    body,
                    CsvOptions(
                        request.headers.get("x-csv-encoding"),
                        request.headers.get("x-csv-delimiter"),
                    ),
                )
                if extension == "csv"
                else parse_xlsx_records(body)
            )
            first = next(records)
        except ImportParseError, StopIteration, UnicodeError, ValueError:
            return JSONResponse({"code": "FILE_REJECTED"}, status_code=415)

        async def stream() -> AsyncIterator[bytes]:
            yield _line(first)
            for record in records:
                yield _line(record)

        return StreamingResponse(stream(), media_type="application/x-ndjson")

    return app


app = create_app()
