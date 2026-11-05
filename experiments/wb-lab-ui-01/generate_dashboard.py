#!/usr/bin/env python3
"""Generate compact, native HomeUI SVG dashboards and their read-only bindings."""

from __future__ import annotations

import json
from html import escape
from pathlib import Path

from telemetry_bridge.contract import CONTROL_LABELS, STAGES


ROOT = Path(__file__).resolve().parent
FONT = "Arial, Helvetica, sans-serif"
BG = "#0b111b"
CARD = "#111c2a"
CARD_ALT = "#142234"
STROKE = "#24364b"
TEXT = "#e8f0fa"
MUTED = "#90a2b8"
CYAN = "#59c8ed"
GREEN = "#43d59c"
RED = "#fb7185"
AMBER = "#f5bd55"
PURPLE = "#c1a6ff"
SLATE = "#a4b2c4"

def esc(value: object) -> str:
    return escape(str(value), quote=True)


def rect(x: int, y: int, w: int, h: int, fill: str, *, rx: int = 12, stroke: str | None = None) -> str:
    outline = f' stroke="{stroke}" stroke-width="1"' if stroke else ""
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{outline}/>'


def line(x1: int, y: int, x2: int, color: str = STROKE, width: int = 1) -> str:
    return f'<path d="M{x1} {y}H{x2}" fill="none" stroke="{color}" stroke-width="{width}"/>'


def text(
    x: int,
    y: int,
    value: object,
    *,
    size: int = 14,
    color: str = TEXT,
    weight: int = 400,
    id_: str | None = None,
    anchor: str = "start",
    letter: float | None = None,
) -> str:
    identifier = f' id="{esc(id_)}"' if id_ else ""
    spacing = f' letter-spacing="{letter}"' if letter is not None else ""
    return (
        f'<text{identifier} x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" '
        f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}"{spacing}>{esc(value)}</text>'
    )


def card_title(x: int, y: int, title: str, subtitle: str | None = None) -> list[str]:
    out = [text(x, y, title.upper(), size=12, color=MUTED, weight=700, letter=1.2)]
    if subtitle:
        out.append(text(x, y + 18, subtitle, size=11, color=MUTED))
    return out


def binding(id_: str, control: str, *, read: str | None = "val", style: str | None = None) -> dict:
    topic = f"/devices/stdu_lab/controls/{control}"
    item: dict = {"id": id_}
    if read is not None:
        item["read"] = {"enable": True, "channel": topic, "value": read}
    if style is not None:
        item["style"] = {"enable": True, "channel": topic, "value": style}
    return item


STATUS_STYLE = (
    "(val == 'PASS') ? ';fill:#43d59c' : "
    "(val == 'FAIL') ? ';fill:#fb7185' : "
    "(val == 'BLOCKED') ? ';fill:#f5bd55' : "
    "(val == 'RUNNING') ? ';fill:#59c8ed' : "
    "(val == 'NOT_PROVEN') ? ';fill:#c1a6ff' : "
    "(val == 'SKIPPED') ? ';fill:#90a2b8' : ';fill:#a4b2c4'"
)
HEALTH_STYLE = (
    "(val == 'ONLINE') ? ';fill:#43d59c' : "
    "(val == 'OFFLINE') ? ';fill:#fb7185' : ';fill:#a4b2c4'"
)
ALARM_STYLE = (
    "(val == 'ACTIVE') ? ';fill:#fb7185' : "
    "(val == 'CLEAR') ? ';fill:#43d59c' : ';fill:#f5bd55'"
)
TELEMETRY_STYLE = (
    "(val == 'FRESH') ? ';fill:#43d59c' : "
    "(val == 'STALE') ? ';fill:#f5bd55' : ';fill:#fb7185'"
)
MODE_STYLE = (
    "(val == 'DEMO') ? ';fill:#f5bd55' : "
    "(val == 'LIVE') ? ';fill:#43d59c' : ';fill:#a4b2c4'"
)
STATUS_COLORS = {
    "NOT_RUN": SLATE,
    "RUNNING": CYAN,
    "PASS": GREEN,
    "FAIL": RED,
    "BLOCKED": AMBER,
    "NOT_PROVEN": PURPLE,
    "SKIPPED": MUTED,
}


def svg_start(title: str, width: int, height: int, description: str) -> list[str]:
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="svg_title svg_desc">',
        f'<title id="svg_title">{esc(title)}</title>',
        f'<desc id="svg_desc">{esc(description)}</desc>',
        '<style>',
        '.panel{fill:#111c2a;stroke:#24364b;stroke-width:1}',
        '.tile{fill:#142234;stroke:#263a50;stroke-width:1}',
        '.label{fill:#90a2b8;font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:1px}',
        '.value{fill:#e8f0fa;font-family:Arial,Helvetica,sans-serif;font-weight:600}',
        '.status{font-family:Arial,Helvetica,sans-serif;font-weight:700;letter-spacing:.25px}',
        '.hairline{stroke:#24364b;stroke-width:1}',
        '</style>',
        rect(0, 0, width, height, BG, rx=0),
    ]


def header_desktop(out: list[str]) -> None:
    out.extend([
        rect(32, 25, 42, 42, "#10293a", rx=12, stroke="#20506a"),
        text(53, 52, "S", size=23, color=CYAN, weight=700, anchor="middle"),
        text(88, 43, "STDU SHOP / TEST LAB", size=16, weight=700, letter=0.6),
        text(88, 65, "WB-LAB-01   ·   ARM64   ·   READ-ONLY MONITOR", size=11, color=MUTED, weight=600, letter=0.5),
        rect(1104, 24, 304, 42, "#322816", rx=12, stroke="#73552b"),
        text(1122, 50, "MODE", size=10, color="#d9bd8a", weight=700, letter=1),
        text(1390, 50, "DEMO · SYNTHETIC", size=13, color=AMBER, weight=700, id_="dash_mode", anchor="end"),
        text(914, 87, "CONTROLLER", size=8, color=MUTED, weight=700, letter=0.6),
        text(1000, 87, "UNKNOWN", size=10, color=SLATE, weight=700, id_="dash_controller_status"),
        text(1150, 87, "UTC", size=8, color=MUTED, weight=700, anchor="end", letter=0.6),
        text(1408, 87, "DEMO SAMPLE", size=10, color=TEXT, weight=600, id_="dash_clock", anchor="end"),
    ])


def header_mobile(out: list[str]) -> None:
    out.extend([
        rect(22, 26, 38, 38, "#10293a", rx=11, stroke="#20506a"),
        text(41, 52, "S", size=21, color=CYAN, weight=700, anchor="middle"),
        text(71, 42, "STDU SHOP", size=15, weight=700, letter=0.5),
        text(71, 62, "TEST LAB · WB-LAB-01", size=10, color=MUTED, weight=600),
        rect(22, 77, 376, 34, "#322816", rx=10, stroke="#73552b"),
        text(38, 99, "MODE", size=9, color="#d9bd8a", weight=700, letter=0.8),
        text(384, 100, "DEMO · SYNTHETIC", size=12, color=AMBER, weight=700, id_="dash_mode", anchor="end"),
        text(24, 128, "CTRL", size=8, color=MUTED, weight=700, letter=0.6),
        text(57, 128, "UNKNOWN", size=9, color=SLATE, weight=700, id_="dash_controller_status"),
        text(252, 128, "UTC", size=8, color=MUTED, weight=700, anchor="end", letter=0.6),
        text(397, 128, "DEMO SAMPLE", size=9, color=TEXT, weight=600, id_="dash_clock", anchor="end"),
    ])


def run_card_desktop(out: list[str]) -> None:
    x, y, w, h = 32, 118, 846, 200
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 24, y + 30, "Current experiment", "One synthetic sample run · not runtime evidence"))
    out.extend([
        rect(x + 24, y + 66, 74, 44, CARD_ALT, rx=10, stroke=STROKE),
        text(x + 61, y + 94, "E1", size=21, color=CYAN, weight=700, id_="dash_stage", anchor="middle"),
        text(x + 118, y + 83, "CURRENT TEST", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 118, y + 105, "Filesystem fsync", size=17, weight=700, id_="dash_current_test"),
        text(x + 24, y + 140, "STATUS", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 24, y + 165, "RUNNING", size=14, color=CYAN, weight=700, id_="dash_run_status"),
        text(x + 190, y + 140, "PROGRESS", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 190, y + 165, "36%", size=14, weight=700, id_="dash_progress"),
        text(x + 333, y + 140, "ELAPSED", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 333, y + 165, "00:00:32", size=14, weight=700, id_="dash_elapsed"),
        text(x + 485, y + 140, "DEMO PASS", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 485, y + 165, "1", size=14, weight=700, id_="dash_passed"),
        text(x + 565, y + 140, "DEMO FAIL", size=9, color=MUTED, weight=700, letter=0.8),
        text(x + 565, y + 165, "0", size=14, weight=700, id_="dash_failed"),
        text(x + 24, y + 190, "RUN", size=9, color=MUTED, weight=700),
        text(x + 63, y + 190, "DEMO-2026-001", size=10, weight=600, id_="dash_run_id"),
        text(x + 520, y + 190, "UPDATED", size=9, color=MUTED, weight=700),
        text(x + 586, y + 190, "DEMO SAMPLE", size=10, weight=600, id_="dash_last_update"),
    ])


def run_card_mobile(out: list[str]) -> None:
    x, y, w, h = 22, 145, 376, 220
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 18, y + 28, "Current experiment", "Synthetic sample · not runtime evidence"))
    out.extend([
        rect(x + 18, y + 58, 62, 40, CARD_ALT, rx=9, stroke=STROKE),
        text(x + 49, y + 84, "E1", size=19, color=CYAN, weight=700, id_="dash_stage", anchor="middle"),
        text(x + 96, y + 68, "CURRENT TEST", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 96, y + 90, "Filesystem fsync", size=14, weight=700, id_="dash_current_test"),
        line(x + 18, y + 112, x + w - 18, y + 112),
        text(x + 18, y + 135, "STATUS", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 18, y + 157, "RUNNING", size=12, color=CYAN, weight=700, id_="dash_run_status"),
        text(x + 142, y + 135, "PROGRESS", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 142, y + 157, "36%", size=12, weight=700, id_="dash_progress"),
        text(x + 258, y + 135, "ELAPSED", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 258, y + 157, "00:00:32", size=12, weight=700, id_="dash_elapsed"),
        text(x + 18, y + 183, "RUN", size=8, color=MUTED, weight=700),
        text(x + 50, y + 183, "DEMO-2026-001", size=10, weight=600, id_="dash_run_id"),
        text(x + 18, y + 205, "UPDATED", size=8, color=MUTED, weight=700),
        text(x + 86, y + 205, "DEMO SAMPLE", size=9, weight=600, id_="dash_last_update"),
    ])


def matrix_rows(out: list[str], x: int, y: int, w: int, *, mobile: bool = False) -> None:
    top = y
    h = 400 if not mobile else 426
    out.append(rect(x, top, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + (18 if mobile else 24), top + 29, "Runtime stage matrix", "Status text is explicit; DEMO never proves runtime PASS"))
    label_x = x + (18 if mobile else 24)
    code_x = x + (64 if mobile else 78)
    status_x = x + w - (18 if mobile else 24)
    out.extend([
        text(label_x, top + 82, "STAGE", size=8, color=MUTED, weight=700, letter=0.8),
        text(code_x, top + 82, "CHECK", size=8, color=MUTED, weight=700, letter=0.8),
        text(status_x, top + 82, "STATE", size=8, color=MUTED, weight=700, anchor="end", letter=0.8),
        line(label_x, top + 94, status_x),
    ])
    step = 36 if mobile else 34
    start = top + 121
    for index, (code, description, sample_status) in enumerate(STAGES):
        row_y = start + index * step
        if index % 2 == 0:
            out.append(rect(x + 10, row_y - 20, w - 20, step, "#0e1926", rx=7))
        out.extend([
            text(label_x + 2, row_y, code, size=11 if mobile else 12, color=CYAN, weight=700),
            text(code_x, row_y, description, size=11 if mobile else 12, color=TEXT, weight=500, id_=f"dash_stage_{code}_label"),
            text(status_x, row_y, sample_status, size=10 if mobile else 11, color=STATUS_COLORS[sample_status], weight=700, id_=f"dash_stage_{code}_status", anchor="end"),
        ])
    out.extend([
        line(label_x, top + h - 45, status_x),
        text(label_x, top + h - 23, "LIVE RUNTIME RESULTS: NOT RUN", size=9, color=AMBER, weight=700),
    ])


def metric_tile(out: list[str], x: int, y: int, w: int, h: int, label: str, value: str, id_: str, unit: str | None = None) -> None:
    out.append(rect(x, y, w, h, CARD_ALT, rx=9, stroke=STROKE))
    out.append(text(x + 12, y + 20, label.upper(), size=8, color=MUTED, weight=700, letter=0.55))
    shown = f"{value} {unit}" if unit else value
    out.append(text(x + 12, y + h - 14, shown, size=16, weight=700, id_=id_))


def resources_desktop(out: list[str]) -> None:
    x, y, w, h = 914, 118, 494, 386
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 22, y + 30, "Host resources", "Synthetic readings · LIVE source not connected"))
    gap = 10
    tile_w = (w - 44 - gap) // 2
    metric_tile(out, x + 22, y + 67, tile_w, 70, "RAM available", "1,140", "dash_ram_available", "MiB")
    metric_tile(out, x + 22 + tile_w + gap, y + 67, tile_w, 70, "CPU load", "28", "dash_cpu_load", "%")
    metric_tile(out, x + 22, y + 147, tile_w, 70, "Disk free", "18.4", "dash_disk_free", "GiB")
    metric_tile(out, x + 22 + tile_w + gap, y + 147, tile_w, 70, "Swap used", "64", "dash_swap_used", "MiB")
    metric_tile(out, x + 22, y + 227, w - 44, 62, "Container RAM peak", "318", "dash_container_peak", "MiB")
    out.extend([
        text(x + 22, y + 317, "POSTGRESQL", size=8, color=MUTED, weight=700, letter=0.8),
        text(x + 154, y + 317, "UNKNOWN", size=11, color=SLATE, weight=700, id_="dash_pg_status"),
        text(x + 255, y + 317, "DOCKER", size=8, color=MUTED, weight=700, letter=0.8),
        text(x + 335, y + 317, "UNKNOWN", size=11, color=SLATE, weight=700, id_="dash_docker_status"),
        text(x + 22, y + 358, "All resource values on this view are synthetic.", size=9, color=MUTED),
    ])


def resources_mobile(out: list[str]) -> None:
    x, y, w, h = 22, 380, 376, 260
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 18, y + 27, "Host resources", "Synthetic readings · LIVE not connected"))
    gap = 8
    tile_w = (w - 36 - gap) // 2
    metric_tile(out, x + 18, y + 56, tile_w, 58, "RAM available", "1,140", "dash_ram_available", "MiB")
    metric_tile(out, x + 18 + tile_w + gap, y + 56, tile_w, 58, "CPU load", "28", "dash_cpu_load", "%")
    metric_tile(out, x + 18, y + 122, tile_w, 58, "Disk free", "18.4", "dash_disk_free", "GiB")
    metric_tile(out, x + 18 + tile_w + gap, y + 122, tile_w, 58, "Swap used", "64", "dash_swap_used", "MiB")
    out.extend([
        text(x + 18, y + 203, "CONTAINER RAM PEAK", size=8, color=MUTED, weight=700),
        text(x + 18, y + 224, "318 MiB", size=13, weight=700, id_="dash_container_peak"),
        text(x + 198, y + 203, "POSTGRESQL", size=8, color=MUTED, weight=700),
        text(x + 198, y + 224, "UNKNOWN", size=10, color=SLATE, weight=700, id_="dash_pg_status"),
        text(x + 292, y + 203, "DOCKER", size=8, color=MUTED, weight=700),
        text(x + 292, y + 224, "UNKNOWN", size=10, color=SLATE, weight=700, id_="dash_docker_status"),
        text(x + 18, y + 247, "Synthetic values only · no live source", size=8, color=MUTED),
    ])


def safety_panel(out: list[str], x: int, y: int, w: int, h: int, *, mobile: bool = False) -> None:
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + (18 if mobile else 22), y + (27 if mobile else 29), "Safety / connection", "Read-only status indicators"))
    entries = [
        ("TELEMETRY", "FRESH", "dash_telemetry_state", TELEMETRY_STYLE),
        ("COLLECTOR", "UNKNOWN", "dash_collector_status", HEALTH_STYLE),
        ("RESOURCE LIMIT", "CLEAR", "dash_limit_exceeded", ALARM_STYLE),
        ("UNKNOWN CLEANUP", "UNKNOWN", "dash_unknown_cleanup", ALARM_STYLE),
        ("RUNTIME GATE", "BLOCKED", "dash_runtime_blocked", ALARM_STYLE),
    ]
    row_step = 31 if mobile else 30
    start_y = y + (81 if mobile else 81)
    for index, (label, value, id_, _) in enumerate(entries):
        row_y = start_y + index * row_step
        if index:
            out.append(line(x + (18 if mobile else 22), row_y - 16, x + w - (18 if mobile else 22)))
        out.append(text(x + (18 if mobile else 22), row_y, label, size=8, color=MUTED, weight=700, letter=0.55))
        static_color = {
            "FRESH": GREEN,
            "STALE": AMBER,
            "NO_DATA": RED,
            "ONLINE": GREEN,
            "OFFLINE": RED,
            "CLEAR": GREEN,
            "ACTIVE": RED,
            "UNKNOWN": AMBER,
            "BLOCKED": AMBER,
        }.get(value, SLATE)
        out.append(text(x + w - (18 if mobile else 22), row_y, value, size=10 if mobile else 11, color=static_color, weight=700, id_=id_, anchor="end"))
    # Broker heartbeat is an opaque counter, never an authorization or run proof.


def events_desktop(out: list[str]) -> None:
    x, y, w, h = 32, 750, 846, 126
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 22, y + 28, "Latest event & error"))
    out.extend([
        text(x + 22, y + 65, "EVENT", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 112, y + 65, "DEMO · E1 probe started", size=11, weight=600, id_="dash_last_event"),
        text(x + 22, y + 91, "ERROR", size=8, color=MUTED, weight=700, letter=0.7),
        text(x + 112, y + 91, "No synthetic error", size=11, weight=600, id_="dash_last_error"),
        text(x + 22, y + 113, "EVENT TIME (UTC)", size=8, color=MUTED, weight=700, letter=0.6),
        text(x + 157, y + 113, "DEMO SAMPLE", size=9, weight=600, id_="dash_event_time"),
        text(x + w - 22, y + 113, "LIVE RUNTIME EVIDENCE: NOT RUN", size=8, color=AMBER, weight=700, anchor="end"),
    ])


def events_mobile(out: list[str]) -> None:
    x, y, w, h = 22, 1344, 376, 195
    out.append(rect(x, y, w, h, CARD, stroke=STROKE))
    out.extend(card_title(x + 18, y + 27, "Latest event & error"))
    out.extend([
        text(x + 18, y + 67, "EVENT", size=8, color=MUTED, weight=700),
        text(x + 82, y + 67, "DEMO · E1 probe started", size=10, weight=600, id_="dash_last_event"),
        text(x + 18, y + 96, "ERROR", size=8, color=MUTED, weight=700),
        text(x + 82, y + 96, "No synthetic error", size=10, weight=600, id_="dash_last_error"),
        text(x + 18, y + 126, "EVENT TIME (UTC)", size=8, color=MUTED, weight=700),
        text(x + 150, y + 126, "DEMO SAMPLE", size=9, weight=600, id_="dash_event_time"),
        line(x + 18, y + 143, x + w - 18),
        text(x + 18, y + 166, "DEMO PASS", size=8, color=MUTED, weight=700),
        text(x + 96, y + 166, "1", size=10, weight=700, id_="dash_passed"),
        text(x + 187, y + 166, "DEMO FAIL", size=8, color=MUTED, weight=700),
        text(x + w - 18, y + 166, "0", size=10, weight=700, id_="dash_failed", anchor="end"),
        text(x + 18, y + 185, "No runtime result is inferred from DEMO.", size=8, color=MUTED),
    ])


def build_bindings() -> list[dict]:
    result: list[dict] = []
    read_map = {
        "dash_mode": ("Source_Mode", "val", MODE_STYLE),
        "dash_controller_status": ("Controller_Status", "val", HEALTH_STYLE),
        "dash_clock": ("Clock_UTC", "val", None),
        "dash_run_id": ("RUN_ID", "val", None),
        "dash_stage": ("Stage", "val", None),
        "dash_current_test": ("Current_Test", "val", None),
        "dash_run_status": ("Status", "val", STATUS_STYLE),
        "dash_progress": ("Progress", "val + '%'", None),
        "dash_elapsed": ("Elapsed", "val", None),
        "dash_last_update": ("Last_Update", "val", None),
        "dash_passed": ("Passed", "val", None),
        "dash_failed": ("Failed", "val", None),
        "dash_ram_available": ("RAM_Available_MiB", "val + ' MiB'", None),
        "dash_cpu_load": ("CPU_Load_Pct", "val + '%'", None),
        "dash_disk_free": ("Disk_Free_GiB", "val + ' GiB'", None),
        "dash_swap_used": ("Swap_Used_MiB", "val + ' MiB'", None),
        "dash_container_peak": ("Container_RAM_Peak_MiB", "val + ' MiB'", None),
        "dash_pg_status": ("PG_Status", "val", HEALTH_STYLE),
        "dash_docker_status": ("Docker_Status", "val", HEALTH_STYLE),
        "dash_last_event": ("Last_Event", "val", None),
        "dash_last_error": ("Last_Error", "val", None),
        "dash_event_time": ("Last_Event_At", "val", None),
        "dash_telemetry_state": ("Telemetry_State", "val", TELEMETRY_STYLE),
        "dash_collector_status": ("Collector_Status", "val", HEALTH_STYLE),
        "dash_limit_exceeded": ("Resource_Limit_Exceeded", "val", ALARM_STYLE),
        "dash_unknown_cleanup": ("Unknown_Cleanup", "val", ALARM_STYLE),
        "dash_runtime_blocked": ("Runtime_Blocked", "val", ALARM_STYLE),
    }
    for id_, (control, expression, style) in read_map.items():
        result.append(binding(id_, control, read=expression, style=style))
    for code, _, _ in STAGES:
        result.append(binding(f"dash_stage_{code}_status", f"Stage_{code}_Status", style=STATUS_STYLE))
        result[-1]["read"] = {"enable": True, "channel": f"/devices/stdu_lab/controls/Stage_{code}_Status", "value": "val"}
    return result


def render_desktop() -> str:
    out = svg_start(
        "STDU SHOP Test Lab · Desktop",
        1440,
        900,
        "Read-only Wiren Board HMI with explicit synthetic DEMO state, runtime stage matrix, resources, events, and safety telemetry.",
    )
    header_desktop(out)
    run_card_desktop(out)
    matrix_rows(out, 32, 334, 846)
    resources_desktop(out)
    safety_panel(out, 914, 520, 494, 210)
    events_desktop(out)
    out.extend([
        text(1408, 893, "STDU LAB  /  READ-ONLY  /  v0.1", size=8, color="#63758a", weight=600, anchor="end", letter=0.5),
        '</svg>',
    ])
    return "\n".join(out) + "\n"


def render_mobile() -> str:
    out = svg_start(
        "STDU SHOP Test Lab · Compact",
        420,
        1560,
        "Compact read-only Wiren Board HMI. All sample values are synthetic DEMO data and not runtime evidence.",
    )
    header_mobile(out)
    run_card_mobile(out)
    resources_mobile(out)
    matrix_rows(out, 22, 655, 376, mobile=True)
    safety_panel(out, 22, 1096, 376, 224, mobile=True)
    events_mobile(out)
    out.extend([
        text(398, 1554, "READ-ONLY · DEMO", size=8, color="#63758a", weight=600, anchor="end", letter=0.5),
        '</svg>',
    ])
    return "\n".join(out) + "\n"


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "dashboard-desktop.svg").write_text(render_desktop(), encoding="utf-8")
    (ROOT / "dashboard-mobile.svg").write_text(render_mobile(), encoding="utf-8")
    (ROOT / "bindings.json").write_text(json.dumps(build_bindings(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
