import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadEnabledConnectorProducts, mergeProducts, resolveProjectPath } from './run-main-buying-engine.mjs';

const bjs = { id: 'bjs', name: "BJ's Wholesale Club" };
const costco = { id: 'costco_business_center', name: 'Costco Business Center' };

test('mergeProducts deduplicates by UPC and keeps all offers while marking the lowest purchase price', () => {
  const [product] = mergeProducts([
    { connector: bjs, product: { supplier: bjs.name, upc: '12345', brand: 'Acme', productName: 'Protein Bar', packageSize: '24 ct', currentPrice: '$19.99' } },
    { connector: costco, product: { supplier: costco.name, upc: '12345', brand: 'Acme', productName: 'Protein Bar', packageSize: '24 ct', currentPrice: '$17.49' } }
  ]);

  assert.equal(product.offerCount, 2);
  assert.equal(product.storeCount, 2);
  assert.equal(product.lowestPurchasePriceDisplay, '$17.49');
  assert.deepEqual(product.lowestPurchaseStores, ['Costco Business Center']);
  assert.equal(product.offers.find((offer) => offer.storeId === 'costco_business_center').isLowestPurchasePrice, true);
});

test('mergeProducts falls back to brand, product name, and package size when UPC is missing', () => {
  const products = mergeProducts([
    { connector: bjs, product: { brand: 'Acme ', productName: '  Mixed Nuts', packageSize: '30 oz', currentPrice: '$8.99' } },
    { connector: costco, product: { brand: 'acme', productName: 'Mixed   Nuts', packageSize: '30 OZ', currentPrice: '$9.49' } },
    { connector: costco, product: { brand: 'Different', productName: 'Mixed Nuts', packageSize: '30 oz', currentPrice: '$7.49' } }
  ]);

  assert.equal(products.length, 2);
  assert.equal(products.find((product) => product.brand === 'Acme ')?.offerCount, 2);
});

test('resolveProjectPath resolves connector artifacts from the current project root', () => {
  assert.equal(resolveProjectPath('artifacts', 'bjs', 'logs', 'deal-products.json'), path.join(process.cwd(), 'artifacts', 'bjs', 'logs', 'deal-products.json'));
});

test('loadEnabledConnectorProducts loads available connector outputs and reports the resolved missing path', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'main-buying-engine-'));
  const bjsDealProductsPath = path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json');
  const missingCostcoDealProductsPath = path.join(tempRoot, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json');
  await mkdir(path.dirname(bjsDealProductsPath), { recursive: true });
  await writeFile(bjsDealProductsPath, JSON.stringify([{ productName: 'BJs Product', currentPrice: '$1.99' }]));

  const { loaded, connectorReports } = await loadEnabledConnectorProducts([
    { ...bjs, enabled: true, dealProductsPath: bjsDealProductsPath },
    { ...costco, enabled: true, dealProductsPath: missingCostcoDealProductsPath }
  ]);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].product.productName, 'BJs Product');
  assert.equal(loaded[0].product.supplier, bjs.name);

  const costcoReport = connectorReports.find((report) => report.connectorId === costco.id);
  assert.equal(costcoReport.status, 'missing_or_failed');
  assert.equal(costcoReport.dealProductsPath, missingCostcoDealProductsPath);
  assert.match(costcoReport.error, new RegExp(`Missing Costco Business Center deal-products\\.json at ${missingCostcoDealProductsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});
