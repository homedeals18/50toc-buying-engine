import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoryAllowed, dealHasVerifiedDiscount, mergeDuplicateProducts, productIdentity } from './deal-filter.js';
import { normalizeBjsPrice } from './price-utils.mjs';
import { runBuyingPipeline, writeCombinedShoppingListReport } from '../shared/buying-engine.js';
import { sanitizeProductBrand } from '../shared/product-brand.mjs';
import { extractPackageSize, normalizePackageSize } from '../shared/product-package.mjs';

const automationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(automationDir, '../..');
const logDir = path.join(repoRoot, 'artifacts', 'bjs', 'logs');
const productsPath = path.join(logDir, 'deal-products.json');
const backupPath = path.join(logDir, 'deal-products.before-price-repair.json');
const reportPath = path.join(logDir, 'shopping-list-report.json');
const upcProgressPath = path.join(logDir, 'upc-enrichment-progress.json');

await mkdir(logDir, { recursive: true });
const saved = JSON.parse(await readFile(productsPath, 'utf8'));
if (!Array.isArray(saved)) throw new Error('BJ\'s deal-products.json must contain an array.');

await copyFile(productsPath, backupPath);

const invalidBrandsRemoved = saved.filter((product) => product.brand && !sanitizeProductBrand(product.brand)).length;
const packageSizesRecovered = saved.filter((product) => !product.packageSize && extractPackageSize(product.productName)).length;
const normalized = saved.map((product) => ({
  ...product,
  brand: sanitizeProductBrand(product.brand),
  packageSize: extractPackageSize(product.productName) ?? normalizePackageSize(product.packageSize),
  currentPrice: normalizeBjsPrice(product.currentPrice),
  originalPrice: normalizeBjsPrice(product.originalPrice)
})).filter((product) => categoryAllowed(product) && dealHasVerifiedDiscount(product));

const deduped = mergeDuplicateProducts(normalized);
const evaluated = await runBuyingPipeline(deduped.products);
await writeFile(productsPath, JSON.stringify(evaluated, null, 2));
let upcProgressEntriesRemoved = 0;
if (existsSync(upcProgressPath)) {
  const progress = JSON.parse(await readFile(upcProgressPath, 'utf8'));
  const allowedKeys = new Set(evaluated.map(productIdentity));
  const previousEntries = Object.entries(progress.products ?? {});
  const filteredEntries = previousEntries.filter(([key]) => allowedKeys.has(key));
  upcProgressEntriesRemoved = previousEntries.length - filteredEntries.length;
  await writeFile(upcProgressPath, JSON.stringify({
    ...progress,
    generatedAt: new Date().toISOString(),
    products: Object.fromEntries(filteredEntries)
  }, null, 2));
}
await writeCombinedShoppingListReport("BJ's Wholesale Club", evaluated, reportPath);

console.log(JSON.stringify({
  before: saved.length,
  after: evaluated.length,
  removedByRules: saved.length - normalized.length,
  duplicatesMerged: deduped.duplicatesMerged,
  invalidBrandsRemoved,
  packageSizesRecovered,
  missingPackageSize: evaluated.filter((product) => !product.packageSize).length,
  upcProgressEntriesRemoved,
  missingCurrentPrice: evaluated.filter((product) => !product.currentPrice).length,
  missingOriginalPrice: evaluated.filter((product) => !product.originalPrice).length,
  backup: backupPath
}, null, 2));
