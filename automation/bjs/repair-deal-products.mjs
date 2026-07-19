import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { categoryAllowed, mergeDuplicateProducts } from './deal-filter.js';
import { normalizeBjsPrice } from './price-utils.mjs';
import { runBuyingPipeline, writeCombinedShoppingListReport } from '../shared/buying-engine.js';

const automationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(automationDir, '../..');
const logDir = path.join(repoRoot, 'artifacts', 'bjs', 'logs');
const productsPath = path.join(logDir, 'deal-products.json');
const backupPath = path.join(logDir, 'deal-products.before-price-repair.json');
const reportPath = path.join(logDir, 'shopping-list-report.json');

await mkdir(logDir, { recursive: true });
const saved = JSON.parse(await readFile(productsPath, 'utf8'));
if (!Array.isArray(saved)) throw new Error('BJ\'s deal-products.json must contain an array.');

await copyFile(productsPath, backupPath);

const normalized = saved.map((product) => ({
  ...product,
  currentPrice: normalizeBjsPrice(product.currentPrice),
  originalPrice: normalizeBjsPrice(product.originalPrice)
})).filter(categoryAllowed);

const deduped = mergeDuplicateProducts(normalized);
const evaluated = await runBuyingPipeline(deduped.products);
await writeFile(productsPath, JSON.stringify(evaluated, null, 2));
await writeCombinedShoppingListReport("BJ's Wholesale Club", evaluated, reportPath);

console.log(JSON.stringify({
  before: saved.length,
  after: evaluated.length,
  removedByRules: saved.length - normalized.length,
  duplicatesMerged: deduped.duplicatesMerged,
  missingCurrentPrice: evaluated.filter((product) => !product.currentPrice).length,
  missingOriginalPrice: evaluated.filter((product) => !product.originalPrice).length,
  backup: backupPath
}, null, 2));
