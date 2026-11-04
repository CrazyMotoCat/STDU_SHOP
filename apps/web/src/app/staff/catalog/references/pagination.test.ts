import { afterEach, expect, it, vi } from 'vitest';
import { readPage } from './api';
import { mergeReferences, windowSize } from './model';

afterEach(() => vi.unstubAllGlobals());

it('requests a single bounded page and passes the cursor and abort signal', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [], meta: { nextCursor: 'next' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const path = '/v1/staff/catalog/attributes?categoryId=test';
  const result = await readPage(path, null, controller.signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await readPage(path, result.meta.nextCursor, controller.signal);
  expect(fetchMock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      search: '?categoryId=test&limit=50&cursor=next',
    }),
    expect.objectContaining({ signal: controller.signal }),
  );
});

it('deduplicates pages, retains fresh revisions and bounds the visible window', () => {
  const fresh = { id: 'kept', version: 3 };
  expect(
    mergeReferences(
      [fresh],
      [
        { id: 'kept', version: 2 },
        { id: 'new', version: 1 },
      ],
    ),
  ).toEqual([fresh, { id: 'new', version: 1 }]);
  const records = Array.from({ length: windowSize + 2 }, (_, id) => ({
    id: String(id),
    version: 1,
  }));
  expect(mergeReferences([], records)).toEqual(records.slice(2));
});
