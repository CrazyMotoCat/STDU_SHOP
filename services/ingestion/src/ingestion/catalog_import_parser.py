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
CELL_TYPES = {"n", "s", "inlineStr", "b", "str", "e"}
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
REL_OFFICE_DOCUMENT = f"{NS_REL}/officeDocument"
REL_WORKSHEET = f"{NS_REL}/worksheet"
REL_SHARED_STRINGS = f"{NS_REL}/sharedStrings"
REL_STYLES = f"{NS_REL}/styles"
MAX_SOURCE_ROW_NUMBER = 2_147_483_647


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


@dataclass(frozen=True)
class XlsxWorkbookParts:
    sheets: list[tuple[str, str]]
    relationships: dict[str, tuple[str, str]]


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


def _source_row_number(value: str) -> int:
    if not re.fullmatch(r"[1-9][0-9]*", value):
        raise ImportParseError("FILE_REJECTED", 415)
    try:
        row_number = int(value)
    except ValueError as error:
        raise ImportParseError("FILE_REJECTED", 415) from error
    if row_number > MAX_SOURCE_ROW_NUMBER:
        raise ImportParseError("FILE_REJECTED", 415)
    return row_number


def _cell_coordinate(reference: str) -> tuple[int, int]:
    match = CELL_REF.fullmatch(reference)
    if not match:
        raise ImportParseError("FILE_REJECTED", 415)
    result = 0
    for character in match.group(1):
        result = result * 26 + ord(character) - 64
    result -= 1
    if result >= MAX_COLUMNS:
        raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
    return result, _source_row_number(match.group(2))


def _nonnegative_index(value: str) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise ImportParseError("FILE_REJECTED", 415)
    try:
        return int(value)
    except ValueError as error:
        raise ImportParseError("FILE_REJECTED", 415) from error


def _shared_strings(archive: zipfile.ZipFile, part: str | None) -> list[str]:
    if part is None:
        return []
    root = _xml_root(archive, part)
    if root.tag != f"{{{NS_MAIN}}}sst":
        raise ImportParseError("FILE_REJECTED", 415)
    strings: list[str] = []
    for item in root.findall(f"{{{NS_MAIN}}}si"):
        value = "".join(text.text or "" for text in item.iter(f"{{{NS_MAIN}}}t"))
        if len(value) > MAX_CELL_CODEPOINTS:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        strings.append(value)
    return strings


def _number_formats(archive: zipfile.ZipFile, part: str | None) -> list[str]:
    if part is None:
        return ["General"]
    root = _xml_root(archive, part)
    if root.tag != f"{{{NS_MAIN}}}styleSheet":
        raise ImportParseError("FILE_REJECTED", 415)
    custom: dict[int, str] = {}
    formats = root.find(f"{{{NS_MAIN}}}numFmts")
    xfs = root.find(f"{{{NS_MAIN}}}cellXfs")
    if xfs is None:
        return ["General"]
    builtins = {0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%"}
    try:
        if formats is not None:
            for item in formats.findall(f"{{{NS_MAIN}}}numFmt"):
                custom[_nonnegative_index(item.attrib["numFmtId"])] = item.attrib.get(
                    "formatCode", "General"
                )
        return [
            custom.get(
                num_fmt_id,
                builtins.get(num_fmt_id, "General"),
            )
            for xf in xfs.findall(f"{{{NS_MAIN}}}xf")
            for num_fmt_id in [_nonnegative_index(xf.attrib.get("numFmtId", "0"))]
        ]
    except KeyError as error:
        raise ImportParseError("FILE_REJECTED", 415) from error


def _relationship_target(base_dir: str, value: str) -> str:
    target = value.replace("\\", "/")
    parts = target.split("/")
    if (
        not target
        or target.startswith("/")
        or any(part in ("", ".", "..") for part in parts)
    ):
        raise ImportParseError("FILE_REJECTED", 415)
    return f"{base_dir}/{target}" if base_dir else target


def _relationship_map(
    archive: zipfile.ZipFile,
    relationship_part: str,
    base_dir: str,
    names: set[str],
) -> dict[str, tuple[str, str]]:
    root = _xml_root(archive, relationship_part)
    if root.tag != f"{{{NS_PACKAGE_REL}}}Relationships":
        raise ImportParseError("FILE_REJECTED", 415)
    result: dict[str, tuple[str, str]] = {}
    for relationship in root.findall(f"{{{NS_PACKAGE_REL}}}Relationship"):
        rel_id = relationship.attrib.get("Id", "")
        rel_type = relationship.attrib.get("Type", "")
        raw_target = relationship.attrib.get("Target", "")
        target_mode = relationship.attrib.get("TargetMode")
        if (
            not rel_id
            or rel_id.strip() != rel_id
            or not rel_type.strip()
            or not raw_target.strip()
            or target_mode not in (None, "Internal")
            or rel_id in result
        ):
            raise ImportParseError("FILE_REJECTED", 415)
        target = _relationship_target(base_dir, raw_target)
        if target not in names:
            raise ImportParseError("FILE_REJECTED", 415)
        result[rel_id] = (rel_type, target)
    return result


def _workbook_part(archive: zipfile.ZipFile, names: set[str]) -> str:
    if "_rels/.rels" not in names:
        raise ImportParseError("FILE_REJECTED", 415)
    relationships = _relationship_map(archive, "_rels/.rels", "", names)
    workbook_targets = [
        target for rel_type, target in relationships.values() if rel_type == REL_OFFICE_DOCUMENT
    ]
    if len(workbook_targets) != 1:
        raise ImportParseError("FILE_REJECTED", 415)
    return workbook_targets[0]


def _relationship_part(source_part: str) -> str:
    directory, _, filename = source_part.rpartition("/")
    return f"{directory + '/' if directory else ''}_rels/{filename}.rels"


def _workbook_parts(archive: zipfile.ZipFile) -> XlsxWorkbookParts:
    names = set(archive.namelist())
    workbook_part = _workbook_part(archive, names)
    workbook = _xml_root(archive, workbook_part)
    if workbook.tag != f"{{{NS_MAIN}}}workbook":
        raise ImportParseError("FILE_REJECTED", 415)
    workbook_dir = workbook_part.rpartition("/")[0]
    rels = _relationship_map(
        archive,
        _relationship_part(workbook_part),
        workbook_dir,
        names,
    )
    sheets = workbook.find(f"{{{NS_MAIN}}}sheets")
    if sheets is None:
        raise ImportParseError("FILE_REJECTED", 415)
    result: list[tuple[str, str]] = []
    seen_relationships: set[str] = set()
    seen_targets: set[str] = set()
    for sheet in sheets.findall(f"{{{NS_MAIN}}}sheet"):
        if len(result) >= MAX_SHEETS:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        rel_id = sheet.attrib.get(f"{{{NS_REL}}}id")
        relationship = rels.get(rel_id or "")
        if (
            not rel_id
            or rel_id in seen_relationships
            or relationship is None
            or relationship[0] != REL_WORKSHEET
        ):
            raise ImportParseError("FILE_REJECTED", 415)
        target_path = relationship[1]
        if target_path in seen_targets:
            raise ImportParseError("FILE_REJECTED", 415)
        seen_relationships.add(rel_id)
        seen_targets.add(target_path)
        name = sheet.attrib.get("name")
        if name is not None and len(name) > 128:
            raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
        result.append((name or "", target_path))
    if not result:
        raise ImportParseError("FILE_REJECTED", 415)
    return XlsxWorkbookParts(result, rels)


def _optional_relationship_part(
    relationships: dict[str, tuple[str, str]], rel_type: str
) -> str | None:
    targets = [target for relationship_type, target in relationships.values() if relationship_type == rel_type]
    if len(targets) > 1:
        raise ImportParseError("FILE_REJECTED", 415)
    return targets[0] if targets else None


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
    seen_rows: set[int] = set()
    try:
        with archive.open(target) as stream:
            if (
                hasattr(stream, "_orig_file_size")
                and stream._orig_file_size > MAX_UNCOMPRESSED_BYTES
            ):
                raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
            _reject_dtd_stream(stream)
        with archive.open(target) as stream:
            root_seen = False
            sheet_data_seen = False
            depth = 0
            for event, element in ET.iterparse(stream, events=("start", "end")):
                if event == "start":
                    depth += 1
                    if not root_seen:
                        root_seen = True
                        if element.tag != f"{{{NS_MAIN}}}worksheet":
                            raise ImportParseError("FILE_REJECTED", 415)
                    elif element.tag == f"{{{NS_MAIN}}}sheetData":
                        if depth != 2 or sheet_data_seen:
                            raise ImportParseError("FILE_REJECTED", 415)
                        sheet_data_seen = True
                    continue
                if element.tag == f"{{{NS_MAIN}}}row":
                    if not sheet_data_seen or depth != 3:
                        raise ImportParseError("FILE_REJECTED", 415)
                    row_number = _source_row_number(element.attrib.get("r", ""))
                    if row_number in seen_rows:
                        raise ImportParseError("FILE_REJECTED", 415)
                    seen_rows.add(row_number)
                    cells: list[dict[str, Any]] = []
                    nonempty = False
                    seen_columns: set[int] = set()
                    for cell in element.findall(f"{{{NS_MAIN}}}c"):
                        column, cell_row_number = _cell_coordinate(cell.attrib.get("r", ""))
                        if cell_row_number != row_number or column in seen_columns:
                            raise ImportParseError("FILE_REJECTED", 415)
                        seen_columns.add(column)
                        value_node = cell.find(f"{{{NS_MAIN}}}v")
                        formula_node = cell.find(f"{{{NS_MAIN}}}f")
                        kind = cell.attrib.get("t", "n")
                        if kind not in CELL_TYPES:
                            raise ImportParseError("FILE_REJECTED", 415)
                        style_index = _nonnegative_index(cell.attrib.get("s", "0"))
                        if style_index >= len(formats):
                            raise ImportParseError("FILE_REJECTED", 415)
                        number_format = formats[style_index]
                        if formula_node is not None:
                            value = "=" + (formula_node.text or "")
                            cell_type = "FORMULA"
                        elif kind == "inlineStr":
                            value = "".join(
                                text.text or "" for text in cell.iter(f"{{{NS_MAIN}}}t")
                            )
                            cell_type = "TEXT" if value else "BLANK"
                        elif value_node is None or value_node.text is None:
                            value, cell_type = "", "BLANK"
                        elif kind == "s":
                            shared_index = _nonnegative_index(value_node.text)
                            if shared_index >= len(shared):
                                raise ImportParseError("FILE_REJECTED", 415)
                            value = shared[shared_index]
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
                depth -= 1
            if not root_seen or not sheet_data_seen:
                raise ImportParseError("FILE_REJECTED", 415)
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
        workbook_parts = _workbook_parts(archive)
        shared = _shared_strings(
            archive,
            _optional_relationship_part(
                workbook_parts.relationships,
                REL_SHARED_STRINGS,
            ),
        )
        formats = _number_formats(
            archive,
            _optional_relationship_part(workbook_parts.relationships, REL_STYLES),
        )
        yield {"type": "START", "protocolVersion": PROTOCOL_VERSION, "sourceFormat": "XLSX"}
        total_rows = 0
        for index, (name, target) in enumerate(workbook_parts.sheets):
            yield {"type": "SHEET", "sheetIndex": index, "sheetName": name}
            for row in _xlsx_rows(archive, target, shared, formats, index):
                if total_rows >= MAX_ROWS:
                    raise ImportParseError("IMPORT_LIMIT_EXCEEDED", 413)
                total_rows += 1
                yield row
        yield {"type": "COMPLETE", "parserVersion": PARSER_VERSION, "sourceParseIssues": []}
