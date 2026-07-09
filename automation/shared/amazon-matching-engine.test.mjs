import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildAmazonMatchingReport, matchProductToAmazon, runAmazonMatchingEngine } from './amazon-matching-engine.mjs';

const amazonCatalog = [
  { asin: 'B000UPC111', upc: '000111222333', brand: 'Acme', title: 'Acme Protein Bars Chocolate 24 ct', packageSize: '24 ct', currentSellingPrice: '$29.99' },
  { asin: 'B000SIZE95', brand: 'Good Co', title: 'Good Co Trail Mix 30 oz', packageSize: '30 oz', currentSellingPrice: 18.5 },
  { asin: 'B000COUNT90', brand: 'Hydro', title: 'Hydro Sparkling Water Lime 12 Pack', count: '12 pack', currentSellingPrice: '$14.25' },
  { asin: 'B000NAME80', brand: 'Snacky', title: 'Snacky Pretzel Crisps', currentSellingPrice: '$9.99' }
];

test('Amazon matching prioritizes UPC at 100 confidence', () => {
  const match = matchProductToAmazon({ productName: 'Different Name', upc: '000111222333', brand: 'Other' }, amazonCatalog);
  assert.equal(match.matched, true);
  assert.equal(match.confidenceScore, 100);
  assert.equal(match.matchReason, 'UPC match');
  assert.equal(match.amazonAsin, 'B000UPC111');
});

test('Amazon matching supports ASIN when already known', () => {
  const match = matchProductToAmazon({ productName: 'Anything', amazonAsin: 'B000SIZE95' }, amazonCatalog);
  assert.equal(match.matched, true);
  assert.equal(match.confidenceScore, 100);
  assert.equal(match.matchReason, 'ASIN match');
});

test('Amazon matching applies required confidence tiers', () => {
  assert.equal(matchProductToAmazon({ brand: 'Good Co', productName: 'Trail Mix', packageSize: '30 oz' }, amazonCatalog).confidenceScore, 95);
  assert.equal(matchProductToAmazon({ brand: 'Hydro', productName: 'Sparkling Water Lime', count: '12 pack' }, amazonCatalog).confidenceScore, 90);
  assert.equal(matchProductToAmazon({ brand: 'Snacky', productName: 'Pretzel Crisps' }, amazonCatalog).confidenceScore, 80);
});

test('Amazon matching marks confidence below 80 as needs review', () => {
  const match = matchProductToAmazon({ brand: 'Unknown', productName: 'Mystery Item' }, amazonCatalog);
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
    { supplier: "BJ's Wholesale Club", brand: 'Good Co', productName: 'Trail Mix', packageSize: '30 oz' },
    { supplier: 'Costco Business Center', brand: 'Unknown', productName: 'No Match' }
  ]));

  try {
    const report = await runAmazonMatchingEngine({ dealProductsPath, amazonCatalog, reportPath });
    const written = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.deepEqual(written.totals, { inputProducts: 2, matched: 1, notMatched: 1, needsReview: 1 });
    assert.equal(report.matches[0].amazonCurrentSellingPrice, '$18.50');
    assert.equal(report.engine, 'amazon-matching-engine-v1');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildAmazonMatchingReport includes confidence rules', () => {
  const report = buildAmazonMatchingReport([], amazonCatalog);
  assert.equal(report.confidenceRules['100'], 'UPC match');
  assert.equal(report.confidenceRules['Below 80'], 'Needs Review');
});
