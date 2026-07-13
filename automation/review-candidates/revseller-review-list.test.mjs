import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildReviewList, loadExistingAmazonResults, reviewCandidatesToCsv, toReviewCandidate } from './revseller-review-list.mjs';

const amazonCatalog = [
  { asin: 'BREADY0001', brand: 'Acme', title: 'Acme Protein Bars Chocolate 24 ct 1.4 oz', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate', currentSellingPrice: '$29.99' },
  { asin: 'BREVIEW001', brand: 'Hydro', title: 'Hydro Sparkling Water Lime 12 Pack 12 fl oz', packageSize: '12 pack 12 fl oz', count: '12 pack', flavor: 'Lime', currentSellingPrice: '$14.25' }
];

test('review candidate contains only operator RevSeller review fields', () => {
  const candidate = toReviewCandidate({ store: "BJ's Wholesale Club", brand: 'Acme', productName: 'Acme Protein Bars Chocolate', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate', currentPrice: 24, finalPurchasePrice: 18, originalPrice: 24, couponDiscount: 6 }, amazonCatalog);
  assert.deepEqual(Object.keys(candidate), ['store', 'storeProductName', 'purchasePrice', 'amazonTitle', 'amazonSellingPrice', 'asin', 'amazonProductUrl', 'matchConfidence', 'matchReason', 'status']);
  assert.equal(candidate.status, 'READY_FOR_REVSELLER_REVIEW');
  assert.equal(candidate.asin, 'BREADY0001');
  assert.equal(candidate.amazonProductUrl, 'https://www.amazon.com/dp/BREADY0001');
  assert.equal(candidate.purchasePrice, '$18.00');
  assert.equal(candidate.amazonSellingPrice, '$29.99');
  assert.ok(!('amazonFees' in candidate));
  assert.ok(!('estimatedProfit' in candidate));
  assert.ok(!('roi' in candidate));
});

test('uncertain pack count becomes NEEDS_MATCH_REVIEW with candidate ASIN', () => {
  const candidate = toReviewCandidate({ store: "Sam's Club", brand: 'Hydro', productName: 'Hydro Sparkling Water Lime', packageSize: '12 fl oz', flavor: 'Lime', currentPrice: '$8.99' }, amazonCatalog);
  assert.equal(candidate.status, 'NEEDS_MATCH_REVIEW');
  assert.equal(candidate.asin, 'BREVIEW001');
  assert.equal(candidate.matchReason, 'Pack count cannot be verified.');
});

test('no strict Amazon match becomes NO_AMAZON_MATCH', () => {
  const candidate = toReviewCandidate({ store: 'Costco Business Center', brand: 'Other', productName: 'Other Snack', packageSize: '1 ct 8 oz', count: '1 ct', currentPrice: '$4.00' }, amazonCatalog);
  assert.equal(candidate.status, 'NO_AMAZON_MATCH');
  assert.equal(candidate.asin, null);
});

test('existing Amazon discovery match keeps known 5-hour Energy ASIN out of NO_AMAZON_MATCH', () => {
  const storeProduct = {
    id: 'five-hour-energy-extra-strength-24ct-1-93floz',
    store: "BJ's Wholesale Club",
    brand: '5-hour Energy',
    productName: '5-hour Energy Extra Strength Berry, 24 ct./1.93 fl. oz.',
    packageSize: '24 ct 1.93 fl oz',
    count: '24 ct',
    currentPrice: '$43.19'
  };
  const existingAmazonResults = [{
    source: 'product-discovery',
    sourceProduct: { ...storeProduct },
    asin: 'B0FX3DY3C7',
    confidenceScore: 95,
    matchReason: 'Existing Amazon Product Discovery match',
    matched: true,
    amazonProduct: {
      asin: 'B0FX3DY3C7',
      title: '5-hour Energy Extra Strength Berry Energy Shot, 1.93 Fl Oz, 24 Count',
      currentSellingPrice: '$52.99',
      productUrl: 'https://www.amazon.com/dp/B0FX3DY3C7',
      brand: '5-hour Energy',
      packageSize: '24 ct 1.93 fl oz',
      count: '24 Count'
    }
  }];

  const candidate = toReviewCandidate(storeProduct, [], existingAmazonResults);

  assert.equal(candidate.asin, 'B0FX3DY3C7');
  assert.notEqual(candidate.status, 'NO_AMAZON_MATCH');
  assert.equal(candidate.status, 'READY_FOR_REVSELLER_REVIEW');
  assert.equal(candidate.matchConfidence, 95);
});

test('loadExistingAmazonResults reads reusable Amazon artifacts without searching', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'review-list-artifacts-'));
  const productDiscoveryPath = path.join(tempRoot, 'product-discovery.json');
  const matchingReportPath = path.join(tempRoot, 'matching-report.json');
  const amazonAnalysisPath = path.join(tempRoot, 'amazon-analysis.json');

  try {
    await writeFile(productDiscoveryPath, JSON.stringify({ discoveries: [{ sourceProduct: { id: 'p1', brand: 'Acme', productName: 'Bars', packageSize: '24 ct' }, matched: true, matchScore: 95, amazonProduct: { asin: 'B0FX3DY3C7', title: 'Acme Bars 24 ct', currentPrice: '$19.99' } }] }));
    await writeFile(matchingReportPath, JSON.stringify({ matches: [{ sourceProduct: { id: 'p2' }, matched: true, confidenceScore: 92, amazonAsin: 'BMATCH0001', amazonTitle: 'Matched Item' }] }));
    await writeFile(amazonAnalysisPath, JSON.stringify({ analyses: [{ storeProduct: { id: 'p3' }, matchScore: 91, amazonProduct: { asin: 'BANALYZE01', title: 'Analyzed Item' } }] }));

    const matches = await loadExistingAmazonResults({ productDiscoveryPath, matchingReportPath, amazonAnalysisPath });

    assert.deepEqual(matches.map((match) => match.asin), ['B0FX3DY3C7', 'BMATCH0001', 'BANALYZE01']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildReviewList integrates available BJ, Costco Business Center, and Sam\'s Club products and writes JSON plus CSV', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'review-list-'));
  const connectors = [
    { id: 'bjs', name: "BJ's Wholesale Club", enabled: true, dealProductsPath: path.join(tempRoot, 'bjs.json') },
    { id: 'costco_business_center', name: 'Costco Business Center', enabled: true, dealProductsPath: path.join(tempRoot, 'costco.json') },
    { id: 'sams_club', name: "Sam's Club", enabled: true, dealProductsPath: path.join(tempRoot, 'sams.json') }
  ];
  await writeFile(connectors[0].dealProductsPath, JSON.stringify([{ brand: 'Acme', productName: 'Acme Protein Bars Chocolate', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate', currentPrice: '$18.00' }]));
  await writeFile(connectors[1].dealProductsPath, JSON.stringify([{ brand: 'Other', productName: 'Other Snack', packageSize: '1 ct 8 oz', count: '1 ct', currentPrice: '$4.00' }]));
  await writeFile(connectors[2].dealProductsPath, JSON.stringify([{ brand: 'Hydro', productName: 'Hydro Sparkling Water Lime', packageSize: '12 fl oz', flavor: 'Lime', currentPrice: '$8.99' }]));
  const jsonPath = path.join(tempRoot, 'artifacts', 'revseller-review-list.json');
  const csvPath = path.join(tempRoot, 'artifacts', 'revseller-review-list.csv');

  try {
    const report = await buildReviewList({
      connectors,
      amazonCatalog,
      amazonArtifactPaths: { productDiscoveryPath: path.join(tempRoot, 'missing-product-discovery.json'), matchingReportPath: path.join(tempRoot, 'missing-matching-report.json'), amazonAnalysisPath: path.join(tempRoot, 'missing-amazon-analysis.json') },
      jsonPath,
      csvPath
    });
    const written = JSON.parse(await readFile(jsonPath, 'utf8'));
    const csv = await readFile(csvPath, 'utf8');
    assert.equal(report.totals.inputProducts, 3);
    assert.equal(written.totals.readyForRevsellerReview, 1);
    assert.equal(written.totals.needsMatchReview, 1);
    assert.equal(written.totals.noAmazonMatch, 1);
    assert.match(csv, /^store,storeProductName,purchasePrice,amazonTitle,amazonSellingPrice,asin,amazonProductUrl,matchConfidence,matchReason,status/);
    assert.match(csv, /READY_FOR_REVSELLER_REVIEW/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test('buildReviewList creates direct review candidate from amazon-analysis storeProduct and amazonProduct', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'review-list-analysis-'));
  const connectors = [
    { id: 'bjs', name: "BJ's Wholesale Club", enabled: true, dealProductsPath: path.join(tempRoot, 'bjs.json') }
  ];
  const amazonAnalysisPath = path.join(tempRoot, 'amazon-analysis.json');
  const jsonPath = path.join(tempRoot, 'artifacts', 'revseller-review-list.json');
  const csvPath = path.join(tempRoot, 'artifacts', 'revseller-review-list.csv');

  try {
    await writeFile(connectors[0].dealProductsPath, JSON.stringify([]));
    await writeFile(amazonAnalysisPath, JSON.stringify({
      storeProduct: {
        store: "BJ's Wholesale Club",
        productName: '5-hour ENERGY Fruity Rainbow 24 ct',
        purchasePrice: '$43.19'
      },
      amazonProduct: {
        asin: 'B0FX3DY3C7',
        title: '5-hour ENERGY Fruity Rainbow 24 ct',
        currentPrice: '$52.99',
        productUrl: 'https://www.amazon.com/dp/B0FX3DY3C7'
      },
      matchScore: 95
    }));

    const report = await buildReviewList({
      connectors,
      amazonCatalog: [],
      amazonArtifactPaths: { productDiscoveryPath: path.join(tempRoot, 'missing-product-discovery.json'), matchingReportPath: path.join(tempRoot, 'missing-matching-report.json'), amazonAnalysisPath },
      jsonPath,
      csvPath
    });

    const candidate = report.candidates.find((entry) => entry.asin === 'B0FX3DY3C7');
    assert.ok(candidate);
    assert.equal(candidate.status, 'READY_FOR_REVSELLER_REVIEW');
    assert.equal(candidate.store, "BJ's Wholesale Club");
    assert.equal(candidate.storeProductName, '5-hour ENERGY Fruity Rainbow 24 ct');
    assert.equal(candidate.purchasePrice, '$43.19');
    assert.equal(candidate.amazonTitle, '5-hour ENERGY Fruity Rainbow 24 ct');
    assert.equal(candidate.amazonSellingPrice, '$52.99');
    assert.equal(candidate.amazonProductUrl, 'https://www.amazon.com/dp/B0FX3DY3C7');
    assert.equal(candidate.matchConfidence, 95);
    assert.equal(report.totals.readyForRevsellerReview, 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CSV escapes commas and quotes', () => {
  const csv = reviewCandidatesToCsv([{ store: 'A, B', storeProductName: 'Quote " Item', purchasePrice: '$1.00', amazonTitle: null, amazonSellingPrice: null, asin: null, amazonProductUrl: null, matchConfidence: 0, matchReason: 'No match', status: 'NO_AMAZON_MATCH' }]);
  assert.match(csv, /"A, B","Quote "" Item"/);
});
