import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import * as filters from './deal-filter.js';
import { normalizeBjsPrice } from './price-utils.mjs';
import { startScan, reusableListingCache } from './listing-cache.mjs';
import { extractDiscountEvidence } from './discount-evidence.mjs';

// Exercise the actual scanner orchestration and persistence offline. Browser
// boundaries and downstream pipeline are replaced; no browser can be launched.
async function harness() {
  const files = new Map();
  let run;
  const fakeTest = (name, callback) => { run = callback; };
  fakeTest.describe = (name, callback) => callback();
  fakeTest.setTimeout = () => {};
  const context = vm.createContext({
    ...filters, normalizeBjsPrice, startScan, reusableListingCache, extractDiscountEvidence,
    path, process: { env: {}, cwd: () => '/offline/automation/bjs' },
    base: { extend: () => fakeTest },
    mkdir: async () => {},
    readFile: async (file) => { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    writeFile: async (file, text) => files.set(file, text),
    runBuyingPipeline: async (products) => products,
    writeCombinedShoppingListReport: async () => {},
    console: { log() {}, warn() {} },
    fixture: [], opened: [], navigation: [], fail: false
  });
  const source = await readFile(new URL('./tests/deal-discovery.spec.js', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context);
  vm.runInContext(`
    ensureAuthenticated = async () => ({});
    navigateToDealSource = async (page, source) => { navigation.push(source.name); return 'https://www.bjs.com/' + source.searchTerm.replaceAll(' ', '-'); };
    extractListingProducts = async (page, source) => fixture.map(product => ({ ...product, dealSource: source.name }));
    expectedResultCount = async () => fixture.length;
    saveStep = async () => 'offline.png';
    enrichProductFromPage = async (page, product) => { opened.push(product.productName); if (fail) throw new Error('Access Denied detected'); return { ...product, sku: 'recovered', originalPrice: '$12.99' }; };
  `, context);
  return {
    context,
    run: () => run({ page: { on() {}, url: () => 'https://www.bjs.com/wow-deals', mouse: { wheel: async () => {} }, waitForTimeout: async () => {} } }),
    json: (name) => JSON.parse(files.get(`/offline/artifacts/bjs/logs/${name}.json`)),
    setJson: (name, value) => files.set(`/offline/artifacts/bjs/logs/${name}.json`, JSON.stringify(value))
  };
}

const product = (name, id = name) => ({ productName: name, category: 'Grocery', currentPrice: '$9.99', originalPrice: '$12.99', discount: 'Clearance', sku: id, productUrl: `https://www.bjs.com/product/${id}/1`, imageUrl: 'image.png', availability: 'In Stock' });

test('actual fresh scan drops old results and skip keys, blocks false positives, and completes', async () => {
  const h = await harness();
  h.setJson('scan-progress', { scanId: 'old', processedProductKeys: ['sku:almonds'] });
  h.setJson('deal-products', [product('Old deal', 'old')]);
  h.context.fixture = [product('Blue Diamond Almonds', 'almonds'), product('Artstyle Lemon Twist Plates'), { ...product('Crackers'), brand: 'Wellsley Farms' }, { ...product('Candy'), currentPrice: '$0', discount: 'Save $3' }];
  await h.run();
  assert.deepEqual(h.json('deal-products').map(p => p.productName), ['Blue Diamond Almonds']);
  assert.ok(h.json('scan-progress').completedAt);
  assert.equal(h.json('scan-progress').processedProductKeys.includes('sku:old'), false);
  assert.equal(h.context.navigation.length, 2);
  assert.equal(h.context.opened.length, 0);
  // A second ordinary run must navigate again and must not retain removed deals.
  h.context.fixture = [product('Skippy Peanut Butter', 'skippy')];
  await h.run();
  assert.equal(h.context.navigation.length, 4);
  assert.deepEqual(h.json('deal-products').map(p => p.productName), ['Skippy Peanut Butter']);
});

test('actual Access Denied recovery retains accepted work and retries only failed products', async () => {
  const h = await harness();
  h.context.fixture = [product('Almonds', 'almonds'), { ...product('Peanut Butter', 'butter'), sku: null }];
  h.context.fail = true;
  await h.run();
  const firstScan = h.json('scan-progress');
  assert.equal(firstScan.completedAt, null);
  assert.deepEqual(h.json('deal-products').map(p => p.productName), ['Almonds']);
  h.context.process.env.BJS_RESUME_SCAN = '1';
  h.context.fail = false;
  h.context.opened.length = 0;
  await h.run();
  assert.equal(h.context.navigation.length, 2, 'recovery uses only same-scan cache');
  assert.deepEqual(Array.from(h.context.opened), ['Peanut Butter']);
  assert.equal(h.json('scan-progress').scanId, firstScan.scanId);
  assert.ok(h.json('scan-progress').completedAt);
  assert.deepEqual(h.json('deal-products').map(p => p.productName), ['Almonds', 'Peanut Butter']);
});
