from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from xml.etree import ElementTree as ET
from xml.parsers import expat

PROTOCOL_VERSION = 1
PARSER_VERSION = "1.0.0"
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_ZIP_ENTRIES = 256
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
MAX_SHEETS = 20
MAX_ROWS = 20_000
MAX_COLUMNS = 128
MAX_CELL_CODEPOINTS = 4_000
MAX_RECORD_BYTES = 1024 * 1024
MAX_META_BYTES = 16 * 1024
CELL_REF = re.compile(r"^([A-Z]{1,3})([1-9][0-9]*)$")
CELL_TYPES = {"s", "inlineStr", "b", "str", "e"}
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"


class ImportParseError(Exception):
    def __init__(self, code: str, status_code: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _reject_dtd_stream(stream: Any) -> None:
    parser = expat.ParserCreate()

    def reject_declaration(*_args: Any) -> None:
        raise ImportParseError("FILE_REJECTED", 415)

    parser.StartDoctypeDeclHandler = reject_declaration
    parser.EntityDeclHandler = reject_declaration
    parser.ExternalEntityRefHandler = lambda *_args: 0
    try:
        while chunk := stream.read(64 * 1024):
            parser.Parse(chunk, False)
        parser.Parse(b"", True)
    except ImportParseError:
        raise
    except expat.ExpatError as error:
        raise ImportParseError("FILE_REJECTED", 415) from error


def _reject_dtd(content: bytes) -> None:
    _reject_dtd_stream(io.BytesIO(content))


@dataclass(frozen=True)
class CsvOptions:
    encoding: str | None
    delimiter: str | None


def _line(record: dict[str, Any]) -> bytes:
    encoded = json.dumps(record, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    limit = MAX_RECORD_BYTES if record.get("type") == "ROW" else MAX_META_BYTES
    if len(encoded) > limit:
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
    return encoded + b"\n"


def _nonempty(value: str) -> bool:
    return value.strip() != ""


def _cell(
    column: int,
    cell_type: str,
    raw: str,
    number_format: str | None = None,
) -> dict[str, Any]:
    if column < 0 or column >= MAX_COLUMNS:
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
    if len(raw) > MAX_CELL_CODEPOINTS:
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
    value: dict[str, Any] = {"columnIndex": column, "cellType": cell_type, "rawValue": raw}
    if number_format is not None:
        if len(number_format) > 64:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        value["numberFormat"] = number_format
    return value


def _detect_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:25])
    counts = {delimiter: sample.count(delimiter) for delimiter in (",", ";", "\t")}
    maximum = max(counts.values(), default=0)
    matches = [delimiter for delimiter, count in counts.items() if count == maximum and count > 0]
    if len(matches) != 1:
        raise ImportParseError("ENCODING_REQUIRED")
    return matches[0]


def parse_csv_records(content: bytes, options: CsvOptions) -> Iterator[dict[str, Any]]:
    if len(content) > MAX_FILE_BYTES:
        raise ImportParseError("FILE_TOO_LARGE", 413)
    if options.encoding not in (None, "UTF-8", "WINDOWS-1251"):
        raise ImportParseError("INVALID_ENCODING")
    encoding = options.encoding or "UTF-8"
    if content.startswith(b"\xef\xbb\xbf"):
        if encoding != "UTF-8":
            raise ImportParseError("INVALID_ENCODING")
        content = content[3:]
    try:
        text = content.decode("utf-8" if encoding == "UTF-8" else "cp1251", errors="strict")
    except UnicodeDecodeError as error:
        raise ImportParseError("INVALID_ENCODING") from error
    delimiter = options.delimiter or _detect_delimiter(text)
    if delimiter not in (",", ";", "\t"):
        raise ImportParseError("VALIDATION_ERROR")
    yield {"type": "START", "protocolVersion": PROTOCOL_VERSION, "sourceFormat": "CSV"}
    yield {"type": "SHEET", "sheetIndex": 0, "sheetName": "CSV"}
    count = 0
    record_number = 0
    try:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
        for record_number, values in enumerate(reader, start=1):
            if len(values) > MAX_COLUMNS:
                raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
            cells = [
                _cell(i, "TEXT" if value else "BLANK", value) for i, value in enumerate(values)
            ]
            if not any(_nonempty(value) for value in values):
                continue
            count += 1
            if count > MAX_ROWS:
                raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
            yield {"type": "ROW", "sheetIndex": 0, "sourceRowNumber": record_number, "cells": cells}
    except csv.Error:
        yield {
            "type": "PARTIAL",
            "parserVersion": PARSER_VERSION,
            "sourceParseIssues": [
                {
                    "code": "MALFORMED_CSV",
                    "message": f"CSV logical record {record_number + 1} could not be parsed.",
                }
            ],
        }
        return
    yield {"type": "COMPLETE", "parserVersion": PARSER_VERSION, "sourceParseIssues": []}


def _xml_root(archive: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        with archive.open(name) as stream:
            content = stream.read(MAX_UNCOMPRESSED_BYTES + 1)
        if len(content) > MAX_UNCOMPRESSED_BYTES:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        _reject_dtd(content)
        return ET.fromstring(content)
    except (KeyError, ET.ParseError, OSError, ValueError, zipfile.BadZipFile) as error:
        raise ImportParseError("FILE_REJECTED", 415) from error


def _column_index(reference: str) -> int:
    match = CELL_REF.fullmatch(reference)
    if not match:
        raise ImportParseError("FILE_REJECTED", 415)
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - 64
    result -= 1
    if result >= MAX_COLUMNS:
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
    return result


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = _xml_root(archive, "xl/sharedStrings.xml")
    strings: list[str] = []
    for item in root.findall(f"{{{NS_MAIN}}}si"):
        value = "".join(text.text or "" for text in item.iter(f"{{{NS_MAIN}}}t"))
        if len(value) > MAX_CELL_CODEPOINTS:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        strings.append(value)
    return strings


def _number_formats(archive: zipfile.ZipFile) -> list[str]:
    if "xl/styles.xml" not in archive.namelist():
        return ["General"]
    root = _xml_root(archive, "xl/styles.xml")
    custom: dict[int, str] = {}
    formats = root.find(f"{{{NS_MAIN}}}numFmts")
    if formats is not None:
        for item in formats.findall(f"{{{NS_MAIN}}}numFmt"):
            custom[int(item.attrib["numFmtId"])] = item.attrib.get("formatCode", "General")
    xfs = root.find(f"{{{NS_MAIN}}}cellXfs")
    if xfs is None:
        return ["General"]
    builtins = {0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%"}
    return [
        custom.get(
            int(xf.attrib.get("numFmtId", "0")),
            builtins.get(int(xf.attrib.get("numFmtId", "0")), "General"),
        )
        for xf in xfs.findall(f"{{{NS_MAIN}}}xf")
    ]


def _sheet_targets(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = _xml_root(archive, "xl/workbook.xml")
    rels = _xml_root(archive, "xl/_rels/workbook.xml.rels")
    targets: dict[str, str] = {}
    for rel in rels.findall(f"{{{NS_PACKAGE_REL}}}Relationship"):
        if rel.attrib.get("TargetMode") == "External":
            raise ImportParseError("FILE_REJECTED", 415)
        target = rel.attrib.get("Target", "").replace("\\", "/")
        if target.startswith("/") or ".." in target.split("/"):
            raise ImportParseError("FILE_REJECTED", 415)
        targets[rel.attrib["Id"]] = "xl/" + target.removeprefix("xl/")
    sheets = workbook.find(f"{{{NS_MAIN}}}sheets")
    if sheets is None:
        raise ImportParseError("FILE_REJECTED", 415)
    result: list[tuple[str, str]] = []
    for sheet in sheets.findall(f"{{{NS_MAIN}}}sheet"):
        if len(result) >= MAX_SHEETS:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        rel_id = sheet.attrib.get(f"{{{NS_REL}}}id")
        target_path = targets.get(rel_id or "")
        if not target_path or target_path not in archive.namelist():
            raise ImportParseError("FILE_REJECTED", 415)
        name = sheet.attrib.get("name")
        if name is not None and len(name) > 128:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        result.append((name or "", target_path))
    if not result:
        raise ImportParseError("FILE_REJECTED", 415)
    return result


def _reject_external_relationships(archive: zipfile.ZipFile) -> None:
    for name in archive.namelist():
        if not name.endswith(".rels"):
            continue
        root = _xml_root(archive, name)
        for relationship in root.findall(f"{{{NS_PACKAGE_REL}}}Relationship"):
            if relationship.attrib.get("TargetMode") == "External":
                raise ImportParseError("FILE_REJECTED", 415)


def _xlsx_rows(
    archive: zipfile.ZipFile,
    target: str,
    shared: list[str],
    formats: list[str],
    sheet_index: int,
) -> Iterator[dict[str, Any]]:
    count = 0
    try:
        with archive.open(target) as stream:
            if (
                hasattr(stream, "_orig_file_size")
                and stream._orig_file_size > MAX_UNCOMPRESSED_BYTES
            ):
                raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
            _reject_dtd_stream(stream)
        with archive.open(target) as stream:
            for _event, element in ET.iterparse(stream, events=("end",)):
                if element.tag != f"{{{NS_MAIN}}}row":
                    continue
                row_number = int(element.attrib.get("r", "0"))
                if row_number < 1:
                    raise ImportParseError("FILE_REJECTED", 415)
                cells: list[dict[str, Any]] = []
                nonempty = False
                for cell in element.findall(f"{{{NS_MAIN}}}c"):
                    column = _column_index(cell.attrib.get("r", ""))
                    value_node = cell.find(f"{{{NS_MAIN}}}v")
                    formula_node = cell.find(f"{{{NS_MAIN}}}f")
                    kind = cell.attrib.get("t", "n")
                    style_index = int(cell.attrib.get("s", "0"))
                    number_format = (
                        formats[style_index] if style_index < len(formats) else "General"
                    )
                    if formula_node is not None:
                        value = "=" + (formula_node.text or "")
                        cell_type = "FORMULA"
                    elif kind == "inlineStr":
                        value = "".join(text.text or "" for text in cell.iter(f"{{{NS_MAIN}}}t"))
                        cell_type = "TEXT" if value else "BLANK"
                    elif value_node is None or value_node.text is None:
                        value, cell_type = "", "BLANK"
                    elif kind == "s":
                        try:
                            value = shared[int(value_node.text)]
                        except (ValueError, IndexError) as error:
                            raise ImportParseError("FILE_REJECTED", 415) from error
                        cell_type = "TEXT"
                    elif kind == "b":
                        value, cell_type = value_node.text, "BOOLEAN"
                    elif kind in ("str", "e"):
                        value, cell_type = value_node.text, "TEXT"
                    else:
                        value, cell_type = value_node.text, "NUMBER"
                    if len(value) > MAX_CELL_CODEPOINTS:
                        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
                    nonempty = nonempty or _nonempty(value)
                    cells.append(_cell(column, cell_type, value, number_format))
                if nonempty:
                    if count >= MAX_ROWS:
                        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
                    count += 1
                    yield {
                        "type": "ROW",
                        "sheetIndex": sheet_index,
                        "sourceRowNumber": row_number,
                        "cells": cells,
                    }
                element.clear()
    except (ET.ParseError, OSError, ValueError, zipfile.BadZipFile) as error:
        raise ImportParseError("FILE_REJECTED", 415) from error


def parse_xlsx_records(content: bytes) -> Iterator[dict[str, Any]]:
    if len(content) > MAX_FILE_BYTES:
        raise ImportParseError("FILE_TOO_LARGE", 413)
    if not content.startswith(b"PK\x03\x04"):
        raise ImportParseError("FILE_REJECTED", 415)
    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
    except (zipfile.BadZipFile, OSError) as error:
        raise ImportParseError("FILE_REJECTED", 415) from error
    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        if sum(info.file_size for info in infos) > MAX_UNCOMPRESSED_BYTES:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        names = {info.filename for info in infos}
        if len(names) != len(infos):
            raise ImportParseError("FILE_REJECTED", 415)
        if any(info.flag_bits & 0x1 for info in infos):
            raise ImportParseError("FILE_REJECTED", 415)
        if any(
            name.startswith("xl/externalLinks/") or "vbaproject" in name.lower() for name in names
        ):
            raise ImportParseError("FILE_REJECTED", 415)
        if "[Content_Types].xml" not in names:
            raise ImportParseError("FILE_REJECTED", 415)
        _reject_external_relationships(archive)
        content_types = _xml_root(archive, "[Content_Types].xml")
        if any("macroEnabled" in item.attrib.get("ContentType", "") for item in content_types):
            raise ImportParseError("FILE_REJECTED", 415)
        shared = _shared_strings(archive)
        formats = _number_formats(archive)
        sheets = _sheet_targets(archive)
        yield {"type": "START", "protocolVersion": PROTOCOL_VERSION, "sourceFormat": "XLSX"}
        total_rows = 0
        for index, (name, target) in enumerate(sheets):
            yield {"type": "SHEET", "sheetIndex": index, "sheetName": name}
            for row in _xlsx_rows(archive, target, shared, formats, index):
                if total_rows >= MAX_ROWS:
                    raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
                total_rows += 1
                yield row
        yield {"type": "COMPLETE", "parserVersion": PARSER_VERSION, "sourceParseIssues": []}
