from __future__ import annotations

import io
import zipfile

import pytest

from ingestion.catalog_import_parser import (
    CsvOptions,
    ImportParseError,
    parse_csv_records,
    parse_xlsx_records,
)


def _xlsx_fixture(*, macro: bool = False) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        content_type = (
            "application/vnd.ms-excel.sheet.macroEnabled.main+xml"
            if macro
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
        )
        archive.writestr(
            "[Content_Types].xml",
            (
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                f'<Override PartName="/xl/workbook.xml" ContentType="{content_type}"/>'
                "</Types>"
            ),
        )
        archive.writestr(
            "xl/workbook.xml",
            (
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Items" sheetId="1" r:id="rId1"/></sheets>'
                "</workbook>"
            ),
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" '
                'Target="worksheets/sheet1.xml"/>'
                "</Relationships>"
            ),
        )
        archive.writestr(
            "xl/styles.xml",
            (
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/>'
                '</numFmts><cellXfs count="2"><xf numFmtId="0"/>'
                '<xf numFmtId="164"/></cellXfs></styleSheet>'
            ),
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>Part</t>'
                '</is></c><c r="B3" s="1"><v>17</v></c><c r="C3"><f>1+1</f>'
                "<v>2</v></c></row></sheetData></worksheet>"
            ),
        )
    return output.getvalue()


def test_csv_preserves_cp1251_and_logical_rows() -> None:
    records = list(
        parse_csv_records(
            "Имя;Артикул\nРеле;00017\n".encode("cp1251"),
            CsvOptions("WINDOWS-1251", ";"),
        )
    )
    assert records[2]["sourceRowNumber"] == 1
    assert records[2]["cells"][0]["rawValue"] == "Имя"
    assert records[3]["cells"][1]["rawValue"] == "00017"


def test_xlsx_preserves_formula_and_zero_mask_without_calculating() -> None:
    records = list(parse_xlsx_records(_xlsx_fixture()))
    row = records[2]
    assert row["type"] == "ROW"
    assert row["sourceRowNumber"] == 3
    assert row["cells"][1] == {
        "columnIndex": 1,
        "cellType": "NUMBER",
        "rawValue": "17",
        "numberFormat": "00000",
    }
    assert row["cells"][2]["cellType"] == "FORMULA"
    assert row["cells"][2]["rawValue"] == "=1+1"


def test_xlsx_macro_enabled_content_is_rejected() -> None:
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(_xlsx_fixture(macro=True)))


def test_xlsx_external_relationship_is_rejected() -> None:
    output = io.BytesIO()
    source = zipfile.ZipFile(io.BytesIO(_xlsx_fixture()))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in source.namelist():
            body = source.read(name)
            if name == "xl/_rels/workbook.xml.rels":
                body = body.replace(
                    b'Target="worksheets/sheet1.xml"',
                    b'Target="https://example.invalid/sheet.xml" TargetMode="External"',
                )
            archive.writestr(name, body)
    source.close()
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(output.getvalue()))


def test_xlsx_external_non_workbook_relationship_is_rejected() -> None:
    output = io.BytesIO()
    source = zipfile.ZipFile(io.BytesIO(_xlsx_fixture()))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in source.namelist():
            archive.writestr(name, source.read(name))
        archive.writestr(
            "xl/worksheets/_rels/sheet1.xml.rels",
            (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" Target="https://example.invalid/data" '
                'TargetMode="External" Type="http://example.invalid/external"/>'
                "</Relationships>"
            ),
        )
    source.close()
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(output.getvalue()))


def test_xlsx_utf16_dtd_entity_is_rejected() -> None:
    output = io.BytesIO()
    source = zipfile.ZipFile(io.BytesIO(_xlsx_fixture()))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in source.namelist():
            body = source.read(name)
            if name == "xl/worksheets/sheet1.xml":
                body = (
                    '<?xml version="1.0" encoding="UTF-16"?>'
                    '<!DOCTYPE worksheet [<!ENTITY injected "expanded">]>'
                    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                    '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&injected;</t>'
                    "</is></c></row></sheetData></worksheet>"
                ).encode("utf-16")
            archive.writestr(name, body)
    source.close()
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(output.getvalue()))


def test_malformed_csv_reports_logical_record_number_and_keeps_prior_rows() -> None:
    records = list(parse_csv_records(b'name;part\nRelay;A1\n"broken', CsvOptions("UTF-8", ";")))
    assert records[2]["sourceRowNumber"] == 1
    assert records[3]["sourceRowNumber"] == 2
    assert records[4] == {
        "type": "PARTIAL",
        "parserVersion": "1.0.0",
        "sourceParseIssues": [
            {
                "code": "MALFORMED_CSV",
                "message": "CSV logical record 3 could not be parsed.",
            }
        ],
    }
