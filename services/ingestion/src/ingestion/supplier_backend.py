"""Authenticated internal fixture extraction for the Nest-owned ingestion backend."""

import asyncio
import base64
import binascii
import hmac
import json
import os
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import UUID4, Field, ValidationError

from ingestion.supplier_ingestion import (
    digest,
    normalize_row,
    parse_rows,
    reject_constant,
    unique_keys,
)
from ingestion.supplier_models import MAX_BYTES, MAX_ROWS, Job, StrictModel

router = APIRouter()
PROTOCOL = "r1-008b.mock.v1"
MAX_REQUEST_BYTES = 2 * MAX_BYTES
MAX_BASE64_LENGTH = 4 * ((MAX_BYTES + 2) // 3)
FIXTURES = {
    "offers-v1": Path(__file__).parent / "fixtures" / "supplier-offers.json",
    "mixed-v1": Path(__file__).parent / "fixtures" / "supplier-mixed.json",
}


class ExtractRequest(StrictModel):
    protocol: Literal["r1-008b.mock.v1"]
    run_id: UUID4
    adapter_version: Literal["fixture-json/1"]
    fixture_key: Literal["offers-v1", "mixed-v1"]
    raw_snapshot: str | None = Field(max_length=MAX_BASE64_LENGTH)


def error(code: str, status: int) -> JSONResponse:
    return JSONResponse({"code": code}, status_code=status, headers={"Cache-Control": "no-store"})


@router.post("/internal/v1/supplier-ingestion/extract")
async def extract_supplier(request: Request) -> JSONResponse:
    token = os.environ.get("SUPPLIER_INGESTION_TOKEN", "")
    if len(token) < 32:
        return error("EXTRACTION_UNAVAILABLE", 503)
    supplied = request.headers.get("authorization", "")
    if not hmac.compare_digest(supplied.encode("utf-8"), f"Bearer {token}".encode()):
        return error("AUTH_REQUIRED", 401)
    if (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        != "application/json"
    ):
        return error("UNSUPPORTED_MEDIA_TYPE", 415)
    length = request.headers.get("content-length")
    if length is not None:
        if len(length) > 10 or not length.isascii() or not length.isdecimal():
            return error("REQUEST_INVALID", 400)
        if int(length) > MAX_REQUEST_BYTES:
            return error("INPUT_LIMIT_EXCEEDED", 413)
    body = bytearray()
    try:
        async with asyncio.timeout(10):
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                    return error("INPUT_LIMIT_EXCEEDED", 413)
                body.extend(chunk)
    except TimeoutError:
        return error("EXTRACTION_TIMEOUT", 408)
    try:
        payload = json.loads(body, object_pairs_hook=unique_keys, parse_constant=reject_constant)
        command = ExtractRequest.model_validate_json(json.dumps(payload))
    except ValueError, RecursionError, ValidationError:
        return error("REQUEST_INVALID", 400)
    if command.raw_snapshot is None:
        try:
            with FIXTURES[command.fixture_key].open("rb") as stream:
                raw = stream.read(MAX_BYTES + 1)
        except OSError:
            return error("SOURCE_UNAVAILABLE", 503)
    else:
        try:
            raw = base64.b64decode(command.raw_snapshot, validate=True)
        except ValueError, binascii.Error:
            return error("SNAPSHOT_INVALID", 422)
        if base64.b64encode(raw).decode("ascii") != command.raw_snapshot:
            return error("SNAPSHOT_INVALID", 422)
    if len(raw) > MAX_BYTES:
        return error("INPUT_LIMIT_EXCEEDED", 413)
    rows = parse_rows(raw)
    if rows is None or len(rows) > MAX_ROWS:
        return error("SOURCE_INVALID", 422)
    source_hash = digest(raw)
    job = Job(
        contract_version="r1-008a.mock.v1",
        profile="mock-only",
        job_id=command.run_id,
        source_id="TEST-synthetic-offers",
    )
    results = [
        normalize_row(job, source_hash, command.adapter_version, number, row).model_dump(
            mode="json"
        )
        for number, row in enumerate(rows, 1)
    ]
    return JSONResponse(
        {
            "protocol": PROTOCOL,
            "run_id": str(command.run_id),
            "adapter_version": command.adapter_version,
            "source_hash": source_hash,
            "raw_snapshot": base64.b64encode(raw).decode("ascii"),
            "results": results,
        },
        headers={"Cache-Control": "no-store"},
    )
