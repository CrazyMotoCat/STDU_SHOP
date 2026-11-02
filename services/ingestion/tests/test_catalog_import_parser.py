from __future__ import annotations

import io
import zipfile

import pytest
from fastapi.testclient import TestClient

from ingestion.catalog_import_parser import (
    CsvOptions,
    ImportParseError,
    parse_csv_records,
    parse_xlsx_records,
)
from ingestion.main import create_app


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
            "_rels/.rels",
            (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'officeDocument" Target="xl/workbook.xml"/>'
                "</Relationships>"
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
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'styles" Target="styles.xml"/>'
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


def _rewrite_xlsx(changes: dict[str, bytes | None]) -> bytes:
    source = zipfile.ZipFile(io.BytesIO(_xlsx_fixture()))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in source.namelist():
            replacement = changes.pop(name, source.read(name))
            if replacement is not None:
                archive.writestr(name, replacement)
        for name, replacement in changes.items():
            if replacement is not None:
                archive.writestr(name, replacement)
    source.close()
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


def test_xlsx_preserves_supported_cell_kinds_and_blank_values() -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" Target="worksheets/sheet1.xml"/>'
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'styles" Target="styles.xml"/>'
                '<Relationship Id="rId3" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'sharedStrings" Target="sharedStrings.xml"/>'
                "</Relationships>"
            ).encode(),
            "xl/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>shared</t></si></sst>"
            ).encode(),
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="1"><c r="A1" t="n"><v>12</v></c>'
                '<c r="B1" t="s"><v>0</v></c>'
                '<c r="C1" t="inlineStr"><is><t>inline</t></is></c>'
                '<c r="D1" t="b"><v>1</v></c>'
                '<c r="E1" t="str"><v>formula text</v></c>'
                '<c r="F1" t="e"><v>#N/A</v></c>'
                '<c r="G1"><f>SUM(1,2)</f><v>3</v></c>'
                '<c r="H1"/></row></sheetData></worksheet>'
            ).encode(),
        }
    )
    row = next(record for record in parse_xlsx_records(content) if record["type"] == "ROW")
    assert [cell["cellType"] for cell in row["cells"]] == [
        "NUMBER",
        "TEXT",
        "TEXT",
        "BOOLEAN",
        "TEXT",
        "TEXT",
        "FORMULA",
        "BLANK",
    ]
    assert [cell["rawValue"] for cell in row["cells"]] == [
        "12",
        "shared",
        "inline",
        "1",
        "formula text",
        "#N/A",
        "=SUM(1,2)",
        "",
    ]


def test_xlsx_resolves_workbook_relationship_target_from_source_part() -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" Target="xl/worksheets/sheet1.xml"/>'
                "</Relationships>"
            ).encode(),
            "xl/xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="9"><c r="A9"><v>linked part</v></c></row>'
                "</sheetData></worksheet>"
            ).encode(),
        }
    )
    rows = [record for record in parse_xlsx_records(content) if record["type"] == "ROW"]
    assert [row["sourceRowNumber"] for row in rows] == [9]
    assert rows[0]["cells"][0]["rawValue"] == "linked part"


def test_xlsx_resolves_styles_and_shared_strings_from_relationships() -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" Target="worksheets/sheet1.xml"/>'
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'styles" Target="custom/styles.xml"/>'
                '<Relationship Id="rId3" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'sharedStrings" Target="custom/sharedStrings.xml"/>'
                "</Relationships>"
            ).encode(),
            "xl/styles.xml": (
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>'
            ).encode(),
            "xl/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>stale orphan</t></si></sst>"
            ).encode(),
            "xl/custom/styles.xml": (
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<numFmts count="1"><numFmt numFmtId="164" formatCode="00000"/>'
                '</numFmts><cellXfs count="2"><xf numFmtId="0"/>'
                '<xf numFmtId="164"/></cellXfs></styleSheet>'
            ).encode(),
            "xl/custom/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>linked shared string</t></si></sst>"
            ).encode(),
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="3"><c r="A3" t="s"><v>0</v></c>'
                '<c r="B3" s="1"><v>17</v></c></row></sheetData></worksheet>'
            ).encode(),
        }
    )
    row = next(record for record in parse_xlsx_records(content) if record["type"] == "ROW")
    assert row["cells"][0]["rawValue"] == "linked shared string"
    assert row["cells"][1]["numberFormat"] == "00000"


@pytest.mark.parametrize("style_index", ["-1", "2"])
def test_xlsx_rejects_negative_or_out_of_range_style_index(style_index: str) -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="3"><c r="B3" s="'
                + style_index
                + '"><v>17</v></c></row></sheetData></worksheet>'
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


@pytest.mark.parametrize("shared_index", ["-1", "1", "not-an-int"])
def test_xlsx_rejects_invalid_shared_string_index(shared_index: str) -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" Target="worksheets/sheet1.xml"/>'
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'sharedStrings" Target="sharedStrings.xml"/>'
                "</Relationships>"
            ).encode(),
            "xl/sharedStrings.xml": (
                '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                "<si><t>part</t></si></sst>"
            ).encode(),
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="3"><c r="A3" t="s"><v>'
                + shared_index
                + "</v></c></row></sheetData></worksheet>"
            ).encode(),
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


@pytest.mark.parametrize(
    "sheet_xml",
    [
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData><row r="3"><c r="A4"><v>1</v></c></row></sheetData></worksheet>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData><row r="3"><c r="A3"><v>1</v></c><c r="A3"><v>2</v></c>'
        "</row></sheetData></worksheet>",
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetData><row r="3"><c r="A3"><v>1</v></c></row>'
        '<row r="3"><c r="B3"><v>2</v></c></row></sheetData></worksheet>',
    ],
)
def test_xlsx_rejects_inconsistent_or_duplicate_coordinates(sheet_xml: str) -> None:
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(_rewrite_xlsx({"xl/worksheets/sheet1.xml": sheet_xml.encode()})))


def test_xlsx_preserves_sparse_cells_even_when_their_xml_order_is_unusual() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="5"><c r="C5"><v>3</v></c><c r="A5"><v>1</v></c>'
                "</row></sheetData></worksheet>"
            ).encode()
        }
    )
    row = next(record for record in parse_xlsx_records(content) if record["type"] == "ROW")
    assert row["sourceRowNumber"] == 5
    assert [cell["columnIndex"] for cell in row["cells"]] == [2, 0]


def test_xlsx_preserves_sparse_rows_even_when_their_xml_order_is_unusual() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="8"><c r="C8"><v>8</v></c></row>'
                '<row r="3"><c r="A3"><v>3</v></c></row></sheetData></worksheet>'
            ).encode()
        }
    )
    rows = [record for record in parse_xlsx_records(content) if record["type"] == "ROW"]
    assert [row["sourceRowNumber"] for row in rows] == [8, 3]


@pytest.mark.parametrize("row_number", ["2147483648", "999999999999999999999"])
def test_xlsx_rejects_source_row_above_postgres_integer_max(row_number: str) -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="'
                + row_number
                + '"><c r="A'
                + row_number
                + '"><v>1</v></c></row></sheetData></worksheet>'
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_accepts_postgres_integer_max_and_sparse_row_numbers() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="2147483647"><c r="A2147483647"><v>1</v></c>'
                "</row></sheetData></worksheet>"
            ).encode()
        }
    )
    row = next(record for record in parse_xlsx_records(content) if record["type"] == "ROW")
    assert row["sourceRowNumber"] == 2_147_483_647


@pytest.mark.parametrize("row_number", ["0", "-1"])
def test_xlsx_rejects_zero_or_negative_source_rows(row_number: str) -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="'
                + row_number
                + '"><c r="A1"><v>1</v></c></row></sheetData></worksheet>'
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_rejects_cell_reference_row_above_postgres_integer_max() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="1"><c r="A2147483648"><v>1</v></c></row>'
                "</sheetData></worksheet>"
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


@pytest.mark.parametrize("cell_type", ["z", "d"])
@pytest.mark.parametrize("formula", [False, True])
def test_xlsx_rejects_unknown_cell_type_even_with_formula(
    cell_type: str, formula: bool
) -> None:
    formula_xml = "<f>1+1</f>" if formula else ""
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="3"><c r="A3" t="'
                + cell_type
                + '">'
                + formula_xml
                + "<v>2</v></c></row></sheetData></worksheet>"
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


@pytest.mark.parametrize(
    "relationship_xml",
    [
        '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        'worksheet" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/worksheet"/>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/worksheet" Target="worksheets/missing.xml"/>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/styles" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    ],
)
def test_xlsx_rejects_malformed_or_wrong_type_sheet_relationships(
    relationship_xml: str,
) -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + relationship_xml
                + "</Relationships>"
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_rejects_relationship_target_that_is_not_a_worksheet_part() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<styles xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_rejects_missing_package_to_workbook_relationship() -> None:
    content = _rewrite_xlsx({"_rels/.rels": None})
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_rejects_relationship_path_traversal() -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
                'worksheet" Target="worksheets/../worksheets/sheet1.xml"/>'
                "</Relationships>"
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_rejects_worksheet_without_required_sheet_data() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
            ).encode()
        }
    )
    with pytest.raises(ImportParseError, match="FILE_REJECTED"):
        list(parse_xlsx_records(content))


def test_xlsx_late_structure_error_returns_json_before_any_ndjson() -> None:
    content = _rewrite_xlsx(
        {
            "xl/worksheets/sheet1.xml": (
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                '<sheetData><row r="1"><c r="A1"><v>1</v></c></row>'
                '<row r="2"><c r="B2"><v>2</v></c></row>'
                '<row r="3"><c r="A4"><v>3</v></c></row></sheetData></worksheet>'
            ).encode()
        }
    )
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={
                "x-source-filename": "late-invalid.xlsx",
                "x-source-mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
        )
    assert response.status_code == 415
    assert response.json() == {"code": "FILE_REJECTED"}
    assert "application/x-ndjson" not in response.headers.get("content-type", "")
    assert not response.content.startswith(b'{"type":"START"')


@pytest.mark.parametrize(
    "relationship_xml",
    [
        '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        'worksheet" Target="worksheets/sheet1.xml"/>',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
        'relationships/styles" Target="worksheets/sheet1.xml"/>',
    ],
)
def test_xlsx_malformed_sheet_relationship_returns_controlled_http_error(
    relationship_xml: str,
) -> None:
    content = _rewrite_xlsx(
        {
            "xl/_rels/workbook.xml.rels": (
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + relationship_xml
                + "</Relationships>"
            ).encode()
        }
    )
    with TestClient(create_app("http://api:3001")) as client:
        response = client.post(
            "/internal/v1/catalog-import/parse",
            content=content,
            headers={
                "x-source-filename": "invalid-relationship.xlsx",
                "x-source-mime": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
        )
    assert response.status_code == 415
    assert response.json() == {"code": "FILE_REJECTED"}
    assert "application/x-ndjson" not in response.headers.get("content-type", "")


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
