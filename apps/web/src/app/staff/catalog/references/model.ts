import type { components } from '@stdu/catalog-client/schema';

type Schemas = components['schemas'];
export type Category = Schemas['CatalogCategory'];
export type Brand = Schemas['CatalogBrand'];
export type Attribute = Schemas['CatalogAttributeDefinition'];
export type Kind = 'categories' | 'brands' | 'attributes';
export type Reference = Category | Brand | Attribute;

export function categoryTree(categories: Category[]) {
  const byParent = new Map<string | null, Category[]>();
  const ids = new Set(categories.map((item) => item.id));
  for (const item of categories) {
    const parent =
      item.parentId && ids.has(item.parentId) ? item.parentId : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(item);
    byParent.set(parent, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'),
    );
  }
  const tree: Array<{ item: Category; depth: number; path: string }> = [];
  const visited = new Set<string>();
  function visit(item: Category, depth: number, parentPath: string) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const path = parentPath ? parentPath + ' / ' + item.name : item.name;
    tree.push({ item, depth, path });
    for (const child of byParent.get(item.id) ?? [])
      visit(child, depth + 1, path);
  }
  for (const item of byParent.get(null) ?? []) visit(item, 0, '');
  for (const item of categories) visit(item, 0, '');
  return tree;
}

export function parseEnumOptions(source: string) {
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length || lines.length > 200)
    throw new Error('Укажите от 1 до 200 вариантов перечисления.');
  const codes = new Set<string>();
  return lines.map((line) => {
    const separator = line.indexOf('=');
    const code = line.slice(0, separator).trim();
    const label = line.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^[a-z][a-z0-9_-]{0,79}$/.test(code) ||
      !label ||
      label.length > 160 ||
      codes.has(code)
    )
      throw new Error(
        'Варианты: уникальный код и название через знак =, по одному варианту на строку.',
      );
    codes.add(code);
    return { code, label };
  });
}
export const windowSize = 250;

export function mergeReferences<T extends { id: string; version: number }>(
  previous: T[],
  incoming: T[],
): T[] {
  const rows = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) {
    const current = rows.get(item.id);
    if (!current || item.version >= current.version) rows.set(item.id, item);
  }
  return Array.from(rows.values()).slice(-windowSize);
}
