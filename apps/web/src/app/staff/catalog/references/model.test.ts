import { describe, expect, it } from 'vitest';
import { categoryTree, parseEnumOptions, type Category } from './model';

function category(
  id: string,
  parentId: string | null,
  sortOrder = 0,
  state: Category['state'] = 'ACTIVE',
): Category {
  return { id, name: id, slug: id, parentId, sortOrder, state, version: 1 };
}

describe('catalog reference workspace', () => {
  it('keeps archived children under their sorted parents and gives search a full path', () => {
    const tree = categoryTree([
      category('child', 'root', 0, 'ARCHIVED'),
      category('second', null, 1),
      category('root', null),
    ]);
    expect(
      tree.map(({ item, depth, path }) => [item.id, item.state, depth, path]),
    ).toEqual([
      ['root', 'ACTIVE', 0, 'root'],
      ['child', 'ARCHIVED', 1, 'root / child'],
      ['second', 'ACTIVE', 0, 'second'],
    ]);
  });

  it('preserves labels and rejects duplicate, malformed or excessive ENUM options', () => {
    expect(parseEnumOptions('a = Alpha\r\n b_2 = Beta = 2')).toEqual([
      { code: 'a', label: 'Alpha' },
      { code: 'b_2', label: 'Beta = 2' },
    ]);
    for (const invalid of [
      '',
      'a = A\na = B',
      '1a = A',
      'a =',
      Array.from({ length: 201 }, (_, i) => `x${i} = option`).join('\n'),
    ]) {
      expect(() => parseEnumOptions(invalid)).toThrow();
    }
  });
});
