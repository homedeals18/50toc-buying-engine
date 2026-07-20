import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildAmazonSearchQuery,
  discoverAmazonProduct,
  fetchAmazonPageTextWithBrowserSession,
  extractAsinFromUrl,
  parseAmazonProductPage,
  parseAmazonSearchResults,
  runAmazonAnalysis,
  runAmazonProductDiscovery,
  selectBestAmazonCandidate
} from './amazon-product-discovery.mjs';
import { sanitizeProductBrand } from './product-brand.mjs';
import { extractPackageSize } from './product-package.mjs';

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



test('fetchAmazonPageTextWithBrowserSession opens pages through the shared browser page', async () => {
  const visited = [];
  const page = {
    async goto(url, options) {
      visited.push({ url, options });
    },
    async content() {
      return productHtml;
    }
  };

  const html = await fetchAmazonPageTextWithBrowserSession('https://www.amazon.com/dp/B000BEST22', { page });
  assert.equal(html, productHtml);
  assert.deepEqual(visited, [{ url: 'https://www.amazon.com/dp/B000BEST22', options: { waitUntil: 'domcontentloaded', timeout: 60_000 } }]);
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



test('discoverAmazonProduct can browse with an existing shared browser page instead of creating a separate fetch client', async () => {
  const visited = [];
  const page = {
    async goto(url) {
      visited.push(url);
    },
    async content() {
      return visited.at(-1).includes('/s?') ? searchHtml : productHtml;
    }
  };

  const discovery = await discoverAmazonProduct(
    { brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' },
    { page }
  );

  assert.deepEqual(visited, ['https://www.amazon.com/s?k=Acme%20Protein%20Bars%20Chocolate%2024%20ct', 'https://www.amazon.com/dp/B000BEST22']);
  assert.equal(discovery.amazonProduct.asin, 'B000BEST22');
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

test('runAmazonAnalysis reuses Product Discovery product page and merges RevSeller data', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'amazon-analysis-'));
  const outputPath = path.join(tempRoot, 'artifacts', 'amazon', 'amazon-analysis.json');
  const visited = [];
  const page = {
    async goto(url) {
      visited.push(url);
    },
    async content() {
      return visited.at(-1).includes('/s?') ? searchHtml : productHtml;
    },
    url() {
      return 'https://www.amazon.com/dp/B000BEST22';
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    locator() {
      return { first: () => ({ async isVisible() { return true; } }) };
    },
    async evaluate(fn) {
      return {
        asin: 'B000BEST22',
        productTitle: 'Acme Protein Bars Chocolate 24 ct',
        productUrl: 'https://www.amazon.com/dp/B000BEST22',
        panelText: 'ASIN: B000BEST22 Product Title: Acme Protein Bars Chocolate 24 ct Amazon Price: $29.99 FBA Fees: $5.32 Estimated Profit: $4.67 ROI: 31% BSR: 12,345 Category: Grocery Hazmat: No Meltable: No IP Alert: None Variation: No'
      };
    }
  };

  try {
    const analysis = await runAmazonAnalysis({
      product: { supplier: "BJ's Wholesale Club", brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' },
      outputPath,
      page
    });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.deepEqual(visited, ['https://www.amazon.com/s?k=Acme%20Protein%20Bars%20Chocolate%2024%20ct', 'https://www.amazon.com/dp/B000BEST22']);
    assert.equal(analysis.amazonProduct.asin, 'B000BEST22');
    assert.equal(analysis.revseller.status, 'success');
    assert.equal(written.revseller.data.currentAmazonPrice, 29.99);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('runAmazonAnalysis saves screenshot, HTML, and structured RevSeller error when unavailable', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'amazon-analysis-missing-revseller-'));
  const outputPath = path.join(tempRoot, 'artifacts', 'amazon', 'amazon-analysis.json');
  const screenshotPath = path.join(tempRoot, 'artifacts', 'amazon', 'revseller-unavailable.png');
  const htmlPath = path.join(tempRoot, 'artifacts', 'amazon', 'revseller-unavailable.html');
  const panelTextPath = path.join(tempRoot, 'artifacts', 'amazon', 'revseller-panel-text.txt');
  const visited = [];
  const page = {
    async goto(url) {
      visited.push(url);
    },
    async content() {
      return visited.at(-1).includes('/s?') ? searchHtml : productHtml;
    },
    url() {
      return 'https://www.amazon.com/dp/B000BEST22';
    },
    async waitForLoadState() {},
    async waitForTimeout() {},
    locator() {
      return { first: () => ({ async isVisible() { return false; } }) };
    },
    async evaluate() {
      return { asin: 'B000BEST22', productTitle: 'Acme Protein Bars Chocolate 24 ct', productUrl: 'https://www.amazon.com/dp/B000BEST22', panelText: '', panelTextNodes: [] };
    },
    async screenshot({ path: target }) {
      await writeFile(target, 'fake image');
    }
  };

  try {
    const analysis = await runAmazonAnalysis({
      product: { brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' },
      outputPath,
      page,
      revsellerOptions: { screenshotPath, htmlPath, panelTextPath }
    });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(analysis.revseller.status, 'error');
    assert.equal(written.revseller.artifacts.screenshotPath, screenshotPath);
    assert.equal(await readFile(htmlPath, 'utf8'), productHtml);
    assert.equal(written.revseller.artifacts.panelTextPath, panelTextPath);
    assert.equal(await readFile(panelTextPath, 'utf8'), '');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('discoverAmazonProduct rejects weak title overlap without opening the product page', async () => {
  const visited = [];
  const weakSearchHtml = '<div data-asin="B0FY2Z9L12"><h2><span>50 Pcs Capri Lemon Oval Paper Plates Party Decorations</span></h2><a href="/dp/B0FY2Z9L12"></a></div>';
  const discovery = await discoverAmazonProduct(
    { productName: 'Artstyle Lemon Twist Summer Oval Plates, 50 ct.', packageSize: '50 ct' },
    {
      fetchText: async (url) => {
        visited.push(url);
        return weakSearchHtml;
      }
    }
  );

  assert.equal(discovery.matched, false);
  assert.equal(discovery.amazonProduct, null);
  assert.ok(discovery.matchScore < 60);
  assert.match(discovery.rejectionReason, /below minimum 60/);
  assert.equal(visited.length, 1);
});


test('rejects a redirected product page whose ASIN and title do not match the selected result', async () => {
  const redirectedHtml = `
    <html><body>
      <input name="ASIN" value="B004Z2484S" />
      <span id="productTitle">Colgate Cavity Protection Fluoride Toothpaste 5 Tubes</span>
    </body></html>
  `;
  const discovery = await discoverAmazonProduct(
    { brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct' },
    { fetchText: async (url) => (url.includes('/s?') ? searchHtml : redirectedHtml) }
  );

  assert.equal(discovery.matched, false);
  assert.equal(discovery.amazonProduct, null);
  assert.equal(discovery.matchScore, 0);
  assert.match(discovery.rejectionReason, /does not match selected ASIN/);
});

test('uses exact UPC before title similarity and rejects a UPC mismatch', () => {
  const exact = selectBestAmazonCandidate(
    { upc: '0012345678905', brand: 'Acme', productName: 'Original Product' },
    [
      { asin: 'B000WRONG1', title: 'Acme Original Product', upc: '0099999999999' },
      { asin: 'B000RIGHT2', title: 'Different Listing Words', upc: '0012345678905' }
    ]
  );
  assert.equal(exact.asin, 'B000RIGHT2');
  assert.equal(exact.matchScore, 100);
});


test('rejects BJ navigation copy as a brand while preserving real brands', () => {
  assert.equal(sanitizeProductBrand('s Recipes & Buying Guides Shopping Locations Coupons BJ'), null);
  assert.equal(sanitizeProductBrand('s Now Ships FREE SNAP EBT Eligible ADD TO CART Smart Summary'), null);
  assert.equal(sanitizeProductBrand('Wellsley Farms'), 'Wellsley Farms');
  assert.equal(sanitizeProductBrand('Berkley Jensen'), 'Berkley Jensen');
});

test('Amazon search query omits polluted BJ brand text', () => {
  const query = buildAmazonSearchQuery({
    brand: 's Recipes & Buying Guides Shopping Locations Coupons BJ',
    productName: 'Artstyle Lemon Twist Summer 12" Oval Plates, 50 ct.',
    packageSize: '50 ct'
  });
  assert.equal(query, 'Artstyle Lemon Twist Summer 12" Oval Plates, 50 ct. 50 ct');
  assert.doesNotMatch(query, /Recipes|Coupons|Shopping Locations/);
});


test('requires manual review when UPC trusted brand and package size are all missing', async () => {
  const exactSearch = '<div data-asin="B0GF9VRJLY"><h2><span>The Pink Stuff The Miracle Squeezable Cleaning Paste 300g</span></h2><a href="/dp/B0GF9VRJLY"></a></div>';
  const exactProduct = '<input name="ASIN" value="B0GF9VRJLY"><span id="productTitle">The Pink Stuff The Miracle Squeezable Cleaning Paste 300g</span>';
  const discovery = await discoverAmazonProduct(
    { productName: 'The Pink Stuff Miracle Cleaning Paste', brand: null, upc: null, packageSize: null },
    { fetchText: async (url) => url.includes('/s?') ? exactSearch : exactProduct }
  );

  assert.equal(discovery.matched, false);
  assert.equal(discovery.needsReview, true);
  assert.equal(discovery.amazonProduct, null);
  assert.match(discovery.rejectionReason, /no UPC, trusted brand, or package size/);
});

test('Amazon analysis records discovery rejection details', async () => {
  const analysis = await runAmazonAnalysis({
    product: { productName: 'The Pink Stuff Miracle Cleaning Paste' },
    fetchText: async () => '<div data-asin="B0GF9VRJLY"><h2><span>The Pink Stuff The Miracle Squeezable Cleaning Paste 300g</span></h2><a href="/dp/B0GF9VRJLY"></a></div>'
  });
  assert.equal(analysis.discovery.matched, false);
  assert.equal(typeof analysis.discovery.rejectionReason, 'string');
});


test('extracts piece counts and combined package sizes from product names', () => {
  assert.equal(extractPackageSize('NUK SafeTemp 12-Pc. Gift Set'), '12 pc');
  assert.equal(extractPackageSize('Reduce Tumbler, 14 oz./2 pk.'), '14 oz / 2 pk');
  assert.equal(extractPackageSize('Cleaning Paste 300g'), '300 g');
  assert.equal(extractPackageSize('Filtrete 20" x 25" x 1" Filters, 3 pk.'), '3 pk');
});

test('Amazon query recovers package size from the store product name', () => {
  const query = buildAmazonSearchQuery({
    productName: 'NUK Simply Natural Bottles with SafeTemp 12-Pc. Gift Set',
    packageSize: null
  });
  assert.match(query, /12 pc$/);
});
