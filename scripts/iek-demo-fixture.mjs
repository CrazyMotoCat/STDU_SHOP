import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from './lib.mjs';

export const demoData = JSON.parse(
  readFileSync(
    resolve(root, 'apps/web/src/lib/catalog/iek-demo-data.json'),
    'utf8',
  ),
);
export function makeDemoProducts() {
  return demoData.products.map((product) => ({
    slug: product.slug,
    displayName: product.displayName,
    brand: { name: 'IEK', slug: 'iek' },
    manufacturerName: 'IEK',
    originalPartNumber: product.manufacturerSKU,
    modification: product.series,
    category: {
      name: product.category,
      slug: product.manufacturerSKU === 'AR-M06N-1-C006' ? 'breakers' : 'rcbo',
    },
    priceDisplay: { kind: 'ON_REQUEST', label: 'Цена по запросу' },
    summary: product.summary,
    description: product.description,
    attributes: product.verifiedAttributes.slice(0, 20).map((attribute) => {
      const type = typeof attribute.value;
      const valueType =
        type === 'boolean'
          ? 'BOOLEAN'
          : type === 'number'
            ? Number.isInteger(attribute.value)
              ? 'INTEGER'
              : 'DECIMAL'
            : 'TEXT';
      return {
        attributeCode: attribute.code,
        label: attribute.label,
        valueType: `CatalogAttributeValue${valueType}`,
        value:
          valueType === 'DECIMAL' ? String(attribute.value) : attribute.value,
        unitCode: attribute.unit
          ? ({
              А: 'A',
              В: 'V',
              кА: 'kA',
              мА: 'mA',
              мм: 'mm',
              'мм²': 'mm2',
              Гц: 'Hz',
              кВ: 'kV',
              '°C': 'degC',
              циклов: 'cycles',
              'Н·м': 'Nm',
            }[attribute.unit] ?? attribute.unit)
          : null,
        unitLabel: attribute.unit || null,
        comparable: false,
      };
    }),
    relations: [],
  }));
}
export const demoProducts = makeDemoProducts();
export const demoCards = demoProducts.map((product) =>
  Object.fromEntries(
    Object.entries(product).filter(
      ([key]) =>
        !['summary', 'description', 'attributes', 'relations'].includes(key),
    ),
  ),
);
export async function prepareSyntheticDemoMedia() {
  for (const product of demoData.products)
    for (const image of product.images) {
      const path = resolve(
        root,
        '.local/vis-cat-01b/media/synthetic',
        image.src,
      );
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(
        path,
        Buffer.from(demoData.syntheticFixture.base64, 'base64'),
      );
    }
}

export const demoCategories = demoProducts.map((product, index) => ({
  ...product.category,
  sortOrder: (index + 1) * 10,
}));
