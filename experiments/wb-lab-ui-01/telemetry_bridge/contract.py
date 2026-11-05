"""Allowlisted, read-only MQTT contract for the STDU lab dashboard."""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any


DEVICE_ID = "stdu_lab"
BASE_TOPIC = f"/devices/{DEVICE_ID}"
STAGES = (
    ("E0a", "Host preflight", "PASS"),
    ("E0b", "PostgreSQL and resources", "NOT_RUN"),
    ("E1", "Filesystem fsync", "RUNNING"),
    ("E2", "Transactions fencing", "NOT_PROVEN"),
    ("E3", "Crash recovery", "BLOCKED"),
    ("E3b", "Recovery evidence", "SKIPPED"),
    ("E4a", "Network isolation", "NOT_RUN"),
    ("E5", "Concurrency", "NOT_RUN"),
)
STAGE_CODES = tuple(stage[0] for stage in STAGES)
STAGE_NAMES = {stage[0]: stage[1] for stage in STAGES}
STATUSES = ("NOT_RUN", "RUNNING", "PASS", "FAIL", "BLOCKED", "NOT_PROVEN", "SKIPPED")
HEALTH = ("ONLINE", "OFFLINE", "UNKNOWN")
FRESHNESS = ("FRESH", "STALE", "NO_DATA")
ALARM = ("CLEAR", "ACTIVE", "UNKNOWN")


def _spec(kind: str, label: str, unit: str | None = None, values: tuple[str, ...] | None = None) -> dict[str, Any]:
    return {"type": kind, "label": label, "unit": unit, "values": values}


CONTROL_SCHEMA: dict[str, dict[str, Any]] = {
    "Source_Mode": _spec("text", "Source mode", values=("DEMO", "LIVE", "UNKNOWN")),
    "Controller_Status": _spec("text", "Controller status", values=HEALTH),
    "Clock_UTC": _spec("text", "Controller clock UTC"),
    "RUN_ID": _spec("text", "Run ID"),
    "Stage": _spec("text", "Current stage", values=(*STAGE_CODES, "UNKNOWN")),
    "Current_Test": _spec("text", "Current test"),
    "Status": _spec("text", "Current test status", values=STATUSES),
    "Progress": _spec("value", "Current test progress", "%"),
    "Elapsed": _spec("text", "Elapsed time"),
    "Last_Update": _spec("text", "Last telemetry update UTC"),
    "Passed": _spec("value", "Passed stages", "count"),
    "Failed": _spec("value", "Failed stages", "count"),
    "RAM_Available_MiB": _spec("value", "Available RAM", "MiB"),
    "CPU_Load_Pct": _spec("value", "CPU load", "%"),
    "Disk_Free_GiB": _spec("value", "Free disk", "GiB"),
    "Swap_Used_MiB": _spec("value", "Swap used", "MiB"),
    "Container_RAM_Peak_MiB": _spec("value", "Container RAM peak", "MiB"),
    "PG_Status": _spec("text", "PostgreSQL status", values=HEALTH),
    "Docker_Status": _spec("text", "Docker status", values=HEALTH),
    "Last_Event": _spec("text", "Last event"),
    "Last_Error": _spec("text", "Last error"),
    "Last_Event_At": _spec("text", "Last event time UTC"),
    "Heartbeat": _spec("value", "Heartbeat sequence", "count"),
    "Telemetry_State": _spec("text", "Telemetry freshness", values=FRESHNESS),
    "Collector_Status": _spec("text", "Collector connection", values=HEALTH),
    "Resource_Limit_Exceeded": _spec("text", "Resource limit exceeded", values=ALARM),
    "Unknown_Cleanup": _spec("text", "Cleanup state unknown", values=ALARM),
    "Runtime_Blocked": _spec("text", "Runtime execution blocked", values=ALARM),
}
for _code in STAGE_CODES:
    CONTROL_SCHEMA[f"Stage_{_code}_Status"] = _spec("text", f"{_code} runtime status", values=STATUSES)

CONTROL_LABELS = {name: (spec["type"], spec["label"], spec["unit"]) for name, spec in CONTROL_SCHEMA.items()}
DEFAULTS: dict[str, Any] = {
    "Source_Mode": "DEMO",
    "Controller_Status": "UNKNOWN",
    "Clock_UTC": "",
    "RUN_ID": "DEMO-WBLAB-01",
    "Stage": "UNKNOWN",
    "Current_Test": "No current test",
    "Status": "NOT_RUN",
    "Progress": 0,
    "Elapsed": "00:00:00",
    "Last_Update": "",
    "Passed": 0,
    "Failed": 0,
    "RAM_Available_MiB": 0,
    "CPU_Load_Pct": 0,
    "Disk_Free_GiB": 0,
    "Swap_Used_MiB": 0,
    "Container_RAM_Peak_MiB": 0,
    "PG_Status": "UNKNOWN",
    "Docker_Status": "UNKNOWN",
    "Last_Event": "No event",
    "Last_Error": "No error",
    "Last_Event_At": "",
    "Heartbeat": 0,
    "Telemetry_State": "NO_DATA",
    "Collector_Status": "OFFLINE",
    "Resource_Limit_Exceeded": "UNKNOWN",
    "Unknown_Cleanup": "UNKNOWN",
    "Runtime_Blocked": "ACTIVE",
    **{f"Stage_{code}_Status": "NOT_RUN" for code in STAGE_CODES},
}

NUMERIC_BOUNDS = {
    "Progress": (0, 100),
    "Passed": (0, 10000),
    "Failed": (0, 10000),
    "RAM_Available_MiB": (0, 2**31 - 1),
    "CPU_Load_Pct": (0, 100),
    "Disk_Free_GiB": (0, 2**31 - 1),
    "Swap_Used_MiB": (0, 2**31 - 1),
    "Container_RAM_Peak_MiB": (0, 2**31 - 1),
    "Heartbeat": (0, 2**63 - 1),
}
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SECRET_WORDS = ("password", "passwd", "token", "jwt", "bearer", "secret", "authorization")
SAFE_TEXT_FIELDS = ("Clock_UTC", "Elapsed", "Last_Update", "Last_Event_At")


def control_topic(control: str) -> str:
    if control not in CONTROL_SCHEMA:
        raise ValueError(f"Unknown telemetry control: {control}")
    return f"{BASE_TOPIC}/controls/{control}"


def classify_freshness(age_seconds: float | None, *, stale_after_seconds: float = 15.0) -> str:
    """Return NO_DATA without a source timestamp; reject future/invalid ages as NO_DATA."""
    if age_seconds is None or not math.isfinite(age_seconds) or age_seconds < 0:
        return "NO_DATA"
    return "STALE" if age_seconds > stale_after_seconds else "FRESH"


def collector_state(connected: bool | None) -> str:
    if connected is None:
        return "UNKNOWN"
    return "ONLINE" if connected else "OFFLINE"


def validate_demo_frame(frame: dict[str, Any]) -> dict[str, Any]:
    """Validate the synthetic-only publisher payload; this adapter cannot emit LIVE."""
    if not isinstance(frame, dict):
        raise ValueError("Telemetry frame must be an object")
    if set(frame) != set(CONTROL_SCHEMA):
        missing = sorted(set(CONTROL_SCHEMA) - set(frame))
        extra = sorted(set(frame) - set(CONTROL_SCHEMA))
        raise ValueError(f"Telemetry frame fields differ from contract (missing={missing}, extra={extra})")
    if frame["Source_Mode"] != "DEMO":
        raise ValueError("This publisher accepts DEMO frames only; LIVE source adapter is not implemented")
    if frame["Status"] not in STATUSES:
        raise ValueError("Status is outside the approved runtime state enumeration")
    if frame["Stage"] not in (*STAGE_CODES, "UNKNOWN"):
        raise ValueError("Stage is outside the approved stage enumeration")
    if not SAFE_ID.fullmatch(str(frame["RUN_ID"])):
        raise ValueError("RUN_ID contains unsupported characters")

    for name, bounds in NUMERIC_BOUNDS.items():
        value = frame[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"{name} must be a finite number")
        if not bounds[0] <= value <= bounds[1]:
            raise ValueError(f"{name} is outside its allowed range")

    for name, spec in CONTROL_SCHEMA.items():
        value = frame[name]
        if spec["type"] == "text":
            if not isinstance(value, str) or len(value) > 128:
                raise ValueError(f"{name} must be a short text value")
            if any(word in value.casefold() for word in SECRET_WORDS):
                raise ValueError(f"{name} contains a forbidden secret-like term")
            if name not in SAFE_TEXT_FIELDS and ("\n" in value or "\r" in value or "\\" in value or "http://" in value or "https://" in value):
                raise ValueError(f"{name} contains unsupported multiline, path, or link data")
            if spec["values"] is not None and value not in spec["values"]:
                raise ValueError(f"{name} is outside its allowed value enumeration")
    return frame


def demo_frame(step: int, *, now: datetime | None = None, collector_connected: bool | None = None) -> dict[str, Any]:
    """Create a small repeatable sample sequence that shows RUNNING→PASS and RUNNING→FAIL."""
    if isinstance(step, bool) or step < 0:
        raise ValueError("step must be a non-negative integer")
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    stamp = instant.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    sequence = step % 4
    freshness = "STALE" if step % 5 == 4 else "FRESH"
    stage_states = {f"Stage_{code}_Status": "NOT_RUN" for code in STAGE_CODES}
    if sequence in (0, 1):
        current_stage = "E0a"
        current_status = "RUNNING" if sequence == 0 else "PASS"
        stage_states["Stage_E0a_Status"] = current_status
        progress = 31 if sequence == 0 else 100
        passed, failed = (0, 0) if sequence == 0 else (1, 0)
        current_test = STAGE_NAMES["E0a"]
        last_event = "Synthetic E0a check started" if sequence == 0 else "Synthetic E0a check completed"
        last_error = "No synthetic error"
    else:
        current_stage = "E0b"
        stage_states["Stage_E0a_Status"] = "PASS"
        current_status = "RUNNING" if sequence == 2 else "FAIL"
        stage_states["Stage_E0b_Status"] = current_status
        progress = 42 if sequence == 2 else 100
        passed, failed = 1, 0 if sequence == 2 else 1
        current_test = STAGE_NAMES["E0b"]
        last_event = "Synthetic E0b check started" if sequence == 2 else "Synthetic E0b failure shown"
        last_error = "Synthetic demo failure" if sequence == 3 else "No synthetic error"

    frame: dict[str, Any] = {
        "Source_Mode": "DEMO",
        "Controller_Status": "UNKNOWN",
        "Clock_UTC": stamp,
        "RUN_ID": "DEMO-WBLAB-01",
        "Stage": current_stage,
        "Current_Test": current_test,
        "Status": current_status,
        "Progress": progress,
        "Elapsed": f"00:00:{(step * 5) % 60:02d}",
        "Last_Update": stamp,
        "Passed": passed,
        "Failed": failed,
        "RAM_Available_MiB": 1140 - (step % 5) * 12,
        "CPU_Load_Pct": 28 + (step % 4) * 3,
        "Disk_Free_GiB": 18.4,
        "Swap_Used_MiB": 64,
        "Container_RAM_Peak_MiB": 318 + (step % 3) * 8,
        "PG_Status": "UNKNOWN",
        "Docker_Status": "UNKNOWN",
        "Last_Event": last_event,
        "Last_Error": last_error,
        "Last_Event_At": stamp,
        "Heartbeat": step + 1,
        "Telemetry_State": freshness,
        "Collector_Status": collector_state(collector_connected),
        "Resource_Limit_Exceeded": "CLEAR",
        "Unknown_Cleanup": "UNKNOWN",
        "Runtime_Blocked": "ACTIVE",
        **stage_states,
    }
    return validate_demo_frame(frame)


def mqtt_messages(frame: dict[str, Any]) -> list[tuple[str, str, bool]]:
    """Return read-only WB MQTT metadata and values; no command topics are generated."""
    validate_demo_frame(frame)
    messages: list[tuple[str, str, bool]] = [
        (f"{BASE_TOPIC}/meta/name", "STDU LAB · TEST TELEMETRY", True),
        (f"{BASE_TOPIC}/meta/driver", "stdu-wb-lab-ui-01-demo", True),
    ]
    for order, (name, spec) in enumerate(CONTROL_SCHEMA.items(), start=1):
        base = control_topic(name)
        metadata = [
            ("name", spec["label"]),
            ("type", spec["type"]),
            ("readonly", "1"),
            ("order", str(order)),
        ]
        if spec["unit"]:
            metadata.append(("units", spec["unit"]))
        for meta_name, value in metadata:
            messages.append((f"{base}/meta/{meta_name}", value, True))
        messages.append((base, str(frame[name]), name != "Heartbeat"))
    return messages
