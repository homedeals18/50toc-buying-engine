import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAmazonMatchingReport, matchProductToAmazon, runAmazonMatchingEngine } from './amazon-matching-engine.mjs';

const amazonCatalog = [
  { asin: 'B000UPC111', upc: '000111222333', brand: 'Acme', title: 'Acme Protein Bars Chocolate 24 ct 1.4 oz', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate', currentSellingPrice: '$29.99' },
  { asin: 'B000SIZE95', brand: 'Good Co', title: 'Good Co Trail Mix 1 ct 30 oz', packageSize: '1 ct 30 oz', count: '1 ct', currentSellingPrice: 18.5 },
  { asin: 'B000COUNT90', brand: 'Hydro', title: 'Hydro Sparkling Water Lime 12 Pack 12 fl oz', packageSize: '12 pack 12 fl oz', count: '12 pack', flavor: 'Lime', currentSellingPrice: '$14.25' },
  { asin: 'B000NAME80', brand: 'Snacky', title: 'Snacky Pretzel Crisps 1 ct', packageSize: '1 ct', count: '1 ct', currentSellingPrice: '$9.99' }
];

test('Amazon matching prioritizes UPC at 100 confidence', () => {
  const match = matchProductToAmazon({ productName: 'Different Name Chocolate 24 ct 1.4 oz', upc: '000111222333', brand: 'Other', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate' }, amazonCatalog);
  assert.equal(match.matched, true);
  assert.equal(match.confidenceScore, 100);
  assert.equal(match.matchReason, 'UPC match + verified package count, size, and flavor gates');
  assert.equal(match.amazonAsin, 'B000UPC111');
});

test('Amazon matching supports ASIN when already known', () => {
  const match = matchProductToAmazon({ productName: 'Anything 1 ct 30 oz', amazonAsin: 'B000SIZE95', packageSize: '1 ct 30 oz', count: '1 ct' }, amazonCatalog);
  assert.equal(match.matched, true);
  assert.equal(match.confidenceScore, 98);
  assert.equal(match.matchReason, 'ASIN match + verified package count, size, and flavor gates');
});

test('Amazon matching applies required confidence tiers', () => {
  assert.equal(matchProductToAmazon({ brand: 'Good Co', productName: 'Trail Mix', packageSize: '1 ct 30 oz', count: '1 ct' }, amazonCatalog).confidenceScore, 92);
  assert.equal(matchProductToAmazon({ brand: 'Hydro', productName: 'Sparkling Water Lime', packageSize: '12 pack 12 fl oz', count: '12 pack', flavor: 'Lime' }, amazonCatalog).confidenceScore, 96);
  assert.equal(matchProductToAmazon({ brand: 'Snacky', productName: 'Pretzel Crisps', packageSize: '1 ct', count: '1 ct' }, amazonCatalog).confidenceScore, 84);
});

test('Amazon matching marks confidence below 80 as needs review', () => {
  const match = matchProductToAmazon({ brand: 'Unknown', productName: 'Mystery Item', packageSize: '1 ct', count: '1 ct' }, amazonCatalog);
  assert.equal(match.matched, false);
  assert.equal(match.needsReview, true);
  assert.equal(match.amazonAsin, null);
  assert.equal(match.matchReason, 'Below 80 = Needs Review');
});

test('Amazon matching report is connector-independent and writable from any deal-products.json path', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'amazon-matching-engine-'));
  const dealProductsPath = path.join(tempRoot, 'any_connector', 'deal-products.json');
  const reportPath = path.join(tempRoot, 'artifacts', 'amazon', 'matching-report.json');
  await mkdir(path.dirname(dealProductsPath), { recursive: true });
  await writeFile(dealProductsPath, JSON.stringify([
    { supplier: "BJ's Wholesale Club", brand: 'Good Co', productName: 'Trail Mix', packageSize: '1 ct 30 oz', count: '1 ct' },
    { supplier: 'Costco Business Center', brand: 'Unknown', productName: 'No Match' }
  ]));

  try {
    const report = await runAmazonMatchingEngine({ dealProductsPath, amazonCatalog, reportPath });
    const written = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(written.totals, { inputProducts: 2, matched: 1, notMatched: 1, needsReview: 1 });
    assert.equal(report.matches[0].amazonCurrentSellingPrice, '$18.50');
    assert.equal(report.engine, 'amazon-matching-engine-v2');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildAmazonMatchingReport includes confidence rules', () => {
  const report = buildAmazonMatchingReport([], amazonCatalog);
  assert.equal(report.confidenceRules['100'], 'UPC match after package count, package size, multi-pack, and flavor gates');
  assert.equal(report.confidenceRules['Below 80'], 'Needs Review');
});


test('Amazon matching v2 rejects package count mismatches and records rejection reason', () => {
  const match = matchProductToAmazon(
    { brand: 'Acme', productName: 'Protein Bars Chocolate', upc: '000111222333', packageSize: '12 ct 1.4 oz', count: '12 ct', flavor: 'Chocolate' },
    amazonCatalog
  );
  assert.equal(match.matched, false);
  assert.equal(match.status, 'Needs Review');
  assert.match(match.rejectionReason, /Pack count is different/);
  assert.equal(match.confidenceScore, 0);
});

test('Amazon matching v2 returns Needs Review when pack count cannot be verified', () => {
  const match = matchProductToAmazon(
    { brand: 'Acme', productName: 'Protein Bars Chocolate', upc: '000111222333', packageSize: '1.4 oz', flavor: 'Chocolate' },
    amazonCatalog
  );
  assert.equal(match.matched, false);
  assert.equal(match.status, 'Needs Review');
  assert.equal(match.rejectionReason, 'Pack count cannot be verified.');
});

test('Amazon matching v2 rejects package size, flavor, and variety-pack mismatches', () => {
  const sizeMismatch = matchProductToAmazon({ brand: 'Acme', productName: 'Protein Bars Chocolate', upc: '000111222333', packageSize: '24 ct 2 oz', count: '24 ct', flavor: 'Chocolate' }, amazonCatalog);
  assert.match(sizeMismatch.rejectionReason, /Package size is different/);

  const flavorMismatch = matchProductToAmazon({ brand: 'Acme', productName: 'Protein Bars Vanilla', upc: '000111222333', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Vanilla' }, amazonCatalog);
  assert.match(flavorMismatch.rejectionReason, /Flavor pack does not match/);

  const varietyMismatch = matchProductToAmazon(
    { brand: 'Acme', productName: 'Protein Bars Chocolate', packageSize: '24 ct 1.4 oz', count: '24 ct', flavor: 'Chocolate' },
    [{ asin: 'BVARIETY01', brand: 'Acme', title: 'Acme Protein Bars Variety Pack 24 ct 1.4 oz', packageSize: '24 ct 1.4 oz', count: '24 ct' }]
  );
  assert.equal(varietyMismatch.rejectionReason, 'Fixed flavor must never match a variety pack.');
});
