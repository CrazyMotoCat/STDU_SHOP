import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseImportSource } from '../src/catalog-import/import-parser.client.js';

afterEach(() => vi.unstubAllGlobals());

describe('catalog import parser protocol client', () => {
  it('accepts a ROW larger than the metadata limit after a completed 250-row batch', async () => {
    const lines = [
      JSON.stringify({
        type: 'START',
        protocolVersion: 1,
        sourceFormat: 'CSV',
      }),
      JSON.stringify({ type: 'SHEET', sheetIndex: 0, sheetName: 'CSV' }),
    ];
    for (let sourceRowNumber = 1; sourceRowNumber <= 250; sourceRowNumber++)
      lines.push(
        JSON.stringify({
          type: 'ROW',
          sheetIndex: 0,
          sourceRowNumber,
          cells: [{ columnIndex: 0, cellType: 'TEXT', rawValue: 'item' }],
        }),
      );
    lines.push(
      JSON.stringify({
        type: 'ROW',
        sheetIndex: 0,
        sourceRowNumber: 251,
        cells: Array.from({ length: 5 }, (_, columnIndex) => ({
          columnIndex,
          cellType: 'TEXT',
          rawValue: 'x'.repeat(4_000),
        })),
      }),
      JSON.stringify({
        type: 'COMPLETE',
        parserVersion: '1.0.0',
        sourceParseIssues: [],
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(`${lines.join('\n')}\n`, {
          headers: { 'content-type': 'application/x-ndjson' },
        }),
      ),
    );
    const batches: number[] = [];
    const result = await parseImportSource({
      content: Buffer.from('fixture'),
      filename: 'fixture.csv',
      declaredMime: 'text/csv',
      format: 'CSV',
      onRows: async (rows) => {
        batches.push(rows.length);
      },
    });

    expect(result.rowCount).toBe(251);
    expect(result.rows).toEqual([]);
    expect(batches).toEqual([250, 1]);
  });
});
