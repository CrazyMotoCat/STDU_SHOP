// Reuse the same pure typed data as the staging server; no external fixture service is required by staging.
export {
  demoProducts,
  demoCards,
  demoCategories,
  makeDemoProducts,
} from '../apps/web/src/lib/catalog/demo-products.ts';
export { default as demoData } from '../apps/web/src/lib/catalog/iek-demo-data.json' with { type: 'json' };
