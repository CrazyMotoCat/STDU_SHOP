"""Local mock extraction protocol, not a SupplierOffer or a business-command DTO."""

import re
import unicodedata
from datetime import datetime
from decimal import Decimal
from typing import Literal
from urllib.parse import urlsplit

from pydantic import UUID4, BaseModel, ConfigDict, Field, field_validator, model_validator

VERSION = "r1-008a.mock.v1"
MAX_ROWS = 100
MAX_BYTES = 1_048_576


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, validate_default=True)


class Job(StrictModel):
    contract_version: Literal["r1-008a.mock.v1"]
    profile: Literal["mock-only"]
    job_id: UUID4
    source_id: str = Field(pattern=r"^TEST-[a-z0-9-]{1,60}$")


class OfferInput(StrictModel):
    supplier_part_number: str | None = Field(default=None, max_length=160)
    offer_name: str | None = Field(default=None, max_length=240)
    source_brand_text: str | None = Field(default=None, max_length=160)
    manufacturer_name: str | None = Field(default=None, max_length=200)
    original_part_number: str | None = Field(default=None, max_length=160)
    modification: str | None = Field(default=None, max_length=160)
    purchase_cost: str | None = Field(default=None, max_length=64)
    currency: Literal["RUB", "USD", "EUR"] | None = None
    source_vat_text: str | None = Field(default=None, max_length=160)
    availability_text: str | None = Field(default=None, max_length=500)
    lead_time_text: str | None = Field(default=None, max_length=160)
    source_observed_at: str | None = Field(default=None, max_length=40)
    source_url: str | None = Field(default=None, max_length=2048)

    @field_validator("*", mode="before")
    @classmethod
    def safe_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value  # Strict core schemas still reject non-string facts.
        value.encode("utf-8")
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("control character")
        # Same identity text normalization as R1-004/R1-007. No fuzzy identity.
        return unicodedata.normalize("NFC", value).strip(" ") or None

    @model_validator(mode="after")
    def source_facts(self) -> OfferInput:
        if not (self.offer_name or self.supplier_part_number or self.original_part_number):
            raise ValueError("offer facts required")
        if self.purchase_cost is not None:
            if not self.currency or not re.fullmatch(
                r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?", self.purchase_cost
            ):
                raise ValueError("explicit currency and decimal required")
            amount = Decimal(self.purchase_cost)
            if amount <= 0:
                raise ValueError("positive price required")
            self.purchase_cost = format(amount, "f")
            if "." in self.purchase_cost:
                self.purchase_cost = self.purchase_cost.rstrip("0").rstrip(".")
        if self.source_observed_at is not None:
            observed = datetime.fromisoformat(self.source_observed_at)
            if observed.tzinfo is None or observed.utcoffset() is None:
                raise ValueError("explicit timezone required")
        if self.source_url is not None:
            url = urlsplit(self.source_url)
            if url.scheme != "https" or url.netloc != "mock.invalid" or url.fragment or url.query:
                raise ValueError("only synthetic source references allowed")
        return self


class Candidate(StrictModel):
    candidate_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    row_number: int = Field(ge=1, le=MAX_ROWS)
    normalized: OfferInput
    identity_status: Literal["UNVERIFIED"] = "UNVERIFIED"
    modification_evidence: Literal["SPECIFIED", "UNKNOWN"]
    warnings: list[str]


class RowError(StrictModel):
    row_number: int = Field(ge=1, le=MAX_ROWS)
    code: Literal["ROW_INVALID"] = "ROW_INVALID"


class Event(StrictModel):
    code: Literal[
        "STARTED",
        "RESUMED",
        "ROW_STAGED",
        "ROW_INVALID",
        "COMPLETE",
        "PARTIAL",
        "INPUT_INVALID",
        "TIME_LIMIT",
    ]
    at: str
    row_number: int | None = None


class Run(StrictModel):
    job: Job
    source_version: str
    adapter_version: str
    supplier_reference: str
    request_fingerprint: str
    raw_sha256: str
    raw_source_blob_ref: Literal["source.json"] = "source.json"
    status: Literal["RUNNING", "COMPLETE", "PARTIAL", "FAILED"] = "RUNNING"
    started_at: str
    finished_at: str | None = None
    duration_ms: int | None = Field(default=None, ge=0)
    attempts: int = Field(default=1, ge=1, le=5)
    processed: int = Field(default=0, ge=0, le=MAX_ROWS)
    candidates: list[Candidate] = Field(default_factory=list, max_length=MAX_ROWS)
    errors: list[RowError] = Field(default_factory=list, max_length=MAX_ROWS)
    events: list[Event] = Field(default_factory=list, max_length=MAX_ROWS + 16)

    @model_validator(mode="after")
    def checkpoint_consistent(self) -> Run:
        started = datetime.fromisoformat(self.started_at)
        if started.utcoffset() is None:
            raise ValueError("checkpoint timestamp needs a timezone")
        if self.status == "RUNNING":
            if self.finished_at is not None or self.duration_ms is not None:
                raise ValueError("running checkpoint cannot be finished")
        elif self.finished_at is None or self.duration_ms is None:
            raise ValueError("terminal checkpoint needs completion metadata")
        elif datetime.fromisoformat(self.finished_at).utcoffset() is None:
            raise ValueError("checkpoint timestamp needs a timezone")
        rows = [c.row_number for c in self.candidates] + [e.row_number for e in self.errors]
        if sorted(rows) != list(range(1, self.processed + 1)):
            raise ValueError("noncontiguous checkpoint")
        if len({c.candidate_id for c in self.candidates}) != len(self.candidates):
            raise ValueError("duplicate candidate")
        if self.status == "COMPLETE" and self.errors:
            raise ValueError("false complete result")
        if self.status == "PARTIAL" and not self.errors:
            raise ValueError("partial result requires row errors")
        if self.status == "FAILED" and self.processed:
            raise ValueError("failed envelope cannot have rows")
        return self


class Manifest(StrictModel):
    request_fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    raw_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
