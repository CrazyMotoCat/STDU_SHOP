import data from './iek-demo-data.json' with { type: 'json' };
import type { PublicAttribute, PublicProduct, PublicProductCard } from './api';

const units: Record<string, string> = {
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
};
export function makeDemoProducts(): PublicProduct[] {
  return data.products.map((product) => ({
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
    attributes: product.verifiedAttributes
      .slice(0, 20)
      .map((attribute): PublicAttribute => {
        const common = {
          attributeCode: attribute.code,
          label: attribute.label,
          unitCode: attribute.unit
            ? (units[attribute.unit] ?? attribute.unit)
            : null,
          unitLabel: attribute.unit || null,
          comparable: false,
        };
        const value = attribute.value;
        if (typeof value === 'boolean')
          return {
            ...common,
            valueType: 'CatalogAttributeValueBOOLEAN',
            value,
          };
        if (typeof value === 'number')
          return Number.isInteger(value)
            ? { ...common, valueType: 'CatalogAttributeValueINTEGER', value }
            : {
                ...common,
                valueType: 'CatalogAttributeValueDECIMAL',
                value: String(value),
              };
        return { ...common, valueType: 'CatalogAttributeValueTEXT', value };
      }),
    relations: [],
  }));
}
export const demoProducts = makeDemoProducts();
export const demoCards: PublicProductCard[] = demoProducts.map((product) => ({
  slug: product.slug,
  displayName: product.displayName,
  brand: product.brand,
  manufacturerName: product.manufacturerName,
  originalPartNumber: product.originalPartNumber,
  modification: product.modification,
  category: product.category,
  priceDisplay: product.priceDisplay,
}));
export const demoCategories = demoProducts.map((product, index) => ({
  ...product.category,
  sortOrder: (index + 1) * 10,
}));
