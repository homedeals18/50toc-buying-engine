import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildAmazonSearchQuery,
  discoverAmazonProduct,
  extractAsinFromUrl,
  parseAmazonProductPage,
  parseAmazonSearchResults,
  runAmazonProductDiscovery,
  selectBestAmazonCandidate
} from './amazon-product-discovery.mjs';

const searchHtml = `
  <div data-asin="B000LOW111"><h2><span>Other Brand Chips 10 oz</span></h2><a href="/dp/B000LOW111/ref=sxin"></a></div>
  <div data-asin="B000BEST22"><h2><span>Acme Protein Bars Chocolate 24 ct</span></h2><a href="/dp/B000BEST22/ref=sr_1_1"></a></div>
`;

const productHtml = `
  <html><head><meta property="og:title" content="Acme Protein Bars Chocolate 24 ct"></head><body>
    <input name="ASIN" value="B000BEST22" />
    <span id="productTitle">Acme Protein Bars Chocolate 24 ct</span>
    <a id="bylineInfo">Visit the Acme Store</a>
    <span class="a-price"><span class="a-offscreen">$29.99</span></span>
  </body></html>
`;

test('buildAmazonSearchQuery uses reusable product fields from connector outputs', () => {
  assert.equal(buildAmazonSearchQuery({ brand: 'Acme', productName: 'Protein Bars', packageSize: '24 ct' }), 'Acme Protein Bars 24 ct');
});

test('extractAsinFromUrl supports Amazon product URLs', () => {
  assert.equal(extractAsinFromUrl('https://www.amazon.com/Anything/dp/B000BEST22/ref=sr_1_1'), 'B000BEST22');
});

test('parseAmazonSearchResults extracts ASIN, title, and product page URL', () => {
  const results = parseAmazonSearchResults(searchHtml);
  assert.equal(results.length, 2);
  assert.deepEqual(results[1], { asin: 'B000BEST22', title: 'Acme Protein Bars Chocolate 24 ct', productUrl: 'https://www.amazon.com/dp/B000BEST22' });
});

test('selectBestAmazonCandidate chooses the strongest source product match', () => {
  const best = selectBestAmazonCandidate({ brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' }, parseAmazonSearchResults(searchHtml));
  assert.equal(best.asin, 'B000BEST22');
  assert.ok(best.matchScore > 80);
});

test('parseAmazonProductPage extracts required discovery fields', () => {
  const product = parseAmazonProductPage(productHtml, 'https://www.amazon.com/dp/B000BEST22');
  assert.equal(product.asin, 'B000BEST22');
  assert.equal(product.title, 'Acme Protein Bars Chocolate 24 ct');
  assert.equal(product.brand, 'Visit the Acme Store');
  assert.equal(product.currentPrice, '$29.99');
  assert.equal(product.packageSize, '24 ct');
});

test('discoverAmazonProduct searches, opens best product page, and stores Amazon product mapping', async () => {
  const visited = [];
  const discovery = await discoverAmazonProduct(
    { supplier: "BJ's Wholesale Club", brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' },
    {
      fetchText: async (url) => {
        visited.push(url);
        return url.includes('/s?') ? searchHtml : productHtml;
      }
    }
  );

  assert.equal(visited.length, 2);
  assert.ok(visited[0].startsWith('https://www.amazon.com/s?k='));
  assert.equal(visited[1], 'https://www.amazon.com/dp/B000BEST22');
  assert.equal(discovery.matched, true);
  assert.equal(discovery.amazonProduct.asin, 'B000BEST22');
  assert.equal(discovery.amazonProduct.currentPrice, '$29.99');
});

test('runAmazonProductDiscovery writes artifacts/amazon/product-discovery.json compatible report', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'amazon-product-discovery-'));
  const inputPath = path.join(tempRoot, 'deal-products.json');
  const outputPath = path.join(tempRoot, 'artifacts', 'amazon', 'product-discovery.json');
  await writeFile(inputPath, JSON.stringify([{ brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' }]));

  try {
    const report = await runAmazonProductDiscovery({
      inputPath,
      outputPath,
      fetchText: async (url) => (url.includes('/s?') ? searchHtml : productHtml)
    });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.engine, 'amazon-product-discovery-v1');
    assert.equal(written.totals.matched, 1);
    assert.equal(written.discoveries[0].amazonProduct.asin, 'B000BEST22');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
