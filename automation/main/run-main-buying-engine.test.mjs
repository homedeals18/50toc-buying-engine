import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadEnabledConnectorProducts, mergeProducts, resolveArtifactPath, resolveProjectPath, runMainBuyingEngine, toProjectRelativePath } from './run-main-buying-engine.mjs';

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

test('resolveArtifactPath resolves connector artifacts from the current project root', () => {
  assert.equal(resolveArtifactPath('bjs', 'logs', 'deal-products.json'), path.resolve('artifacts', 'bjs', 'logs', 'deal-products.json'));
});

test('resolveProjectPath is stable when the process is launched from a subdirectory', async () => {
  const originalCwd = process.cwd();
  try {
    process.chdir(path.join(originalCwd, 'automation', 'main'));
    assert.equal(resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json'), path.join(originalCwd, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json'));
  } finally {
    process.chdir(originalCwd);
  }
});


test('toProjectRelativePath stores in-repository artifact paths without machine-specific roots', () => {
  assert.equal(toProjectRelativePath(resolveArtifactPath('main', 'final-shopping-list.json')), 'artifacts/main/final-shopping-list.json');
});

test('loadEnabledConnectorProducts loads available connector outputs and reports the resolved missing path as a warning', async () => {
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
  assert.equal(costcoReport.status, 'missing');
  assert.equal(costcoReport.severity, 'warning');
  assert.equal(costcoReport.dealProductsPath, missingCostcoDealProductsPath);
  assert.match(costcoReport.warning, new RegExp(`Missing Costco Business Center deal-products\\.json at ${missingCostcoDealProductsPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});



test('loadEnabledConnectorProducts resolves relative deal-products paths from repositoryRoot when launched from a subdirectory', async () => {
  const originalCwd = process.cwd();
  const relativeDealProductsPath = path.join('artifacts', 'main-buying-engine-test', 'logs', 'deal-products.json');
  const resolvedDealProductsPath = resolveProjectPath(relativeDealProductsPath);
  await mkdir(path.dirname(resolvedDealProductsPath), { recursive: true });
  await writeFile(resolvedDealProductsPath, JSON.stringify([{ productName: 'Relative Costco Product', currentPrice: '$3.99' }]));

  try {
    process.chdir(path.join(originalCwd, 'automation', 'main'));
    const { loaded, connectorReports } = await loadEnabledConnectorProducts([
      { ...costco, enabled: true, dealProductsPath: relativeDealProductsPath }
    ]);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].product.productName, 'Relative Costco Product');

    const [costcoReport] = connectorReports;
    assert.equal(costcoReport.status, 'loaded');
    assert.equal(costcoReport.dealProductsPath, relativeDealProductsPath.split(path.sep).join(path.posix.sep));
    assert.equal(costcoReport.repoRoot, originalCwd);
    assert.equal(costcoReport.resolvedDealProductsPath, resolvedDealProductsPath);
    assert.equal(costcoReport.exists, true);
  } finally {
    process.chdir(originalCwd);
    await rm(path.dirname(path.dirname(resolvedDealProductsPath)), { recursive: true, force: true });
  }
});


test('loadEnabledConnectorProducts trims connector deal-products paths before checking disk', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'main-buying-engine-trimmed-path-'));
  const dealProductsPath = path.join(tempRoot, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json');
  await mkdir(path.dirname(dealProductsPath), { recursive: true });
  await writeFile(dealProductsPath, JSON.stringify([{ productName: 'Trimmed Path Product', currentPrice: '$4.99' }]));

  try {
    const { loaded, connectorReports } = await loadEnabledConnectorProducts([
      { ...costco, enabled: true, dealProductsPath: ` ${dealProductsPath}
` }
    ]);

    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].product.productName, 'Trimmed Path Product');
    assert.equal(connectorReports[0].status, 'loaded');
    assert.equal(connectorReports[0].resolvedDealProductsPath, dealProductsPath);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("runMainBuyingEngine preserves Costco products when BJ's deal-products.json is missing", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'main-buying-engine-costco-'));
  const missingBjsDealProductsPath = path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json');
  const costcoDealProductsPath = path.join(tempRoot, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json');
  await mkdir(path.dirname(costcoDealProductsPath), { recursive: true });
  await writeFile(costcoDealProductsPath, JSON.stringify([{ supplier: 'Costco Business Center', productName: 'Costco Product', brand: 'Kirkland', packageSize: '12 ct', currentPrice: '$12.99' }]));

  const { finalProducts, report } = await runMainBuyingEngine([
    { ...bjs, enabled: true, dealProductsPath: missingBjsDealProductsPath },
    { ...costco, enabled: true, dealProductsPath: costcoDealProductsPath }
  ]);

  assert.equal(finalProducts.length, 1);
  assert.equal(finalProducts[0].productName, 'Costco Product');
  assert.equal(finalProducts[0].offers[0].storeId, 'costco_business_center');
  assert.equal(report.totals.loadedProducts, 1);
  assert.equal(report.connectors.find((connector) => connector.connectorId === 'bjs').severity, 'warning');
  assert.equal(report.outputs.finalShoppingList, 'artifacts/main/final-shopping-list.json');
  assert.equal(report.outputs.finalExecutionReport, 'artifacts/main/final-execution-report.json');

  const writtenShoppingList = JSON.parse(await readFile(resolveProjectPath('artifacts', 'main', 'final-shopping-list.json'), 'utf8'));
  assert.equal(writtenShoppingList.length, 1);
  assert.equal(writtenShoppingList[0].productName, 'Costco Product');
});
