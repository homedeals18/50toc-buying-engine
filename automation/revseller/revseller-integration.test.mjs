import assert from 'node:assert/strict';
import test from 'node:test';
import { amazonMatchQuery, extractAmazonProductFromPage, extractRevsellerFields, isAmazonProductPageUrl } from './revseller-integration.mjs';

test('extracts RevSeller panel fields without calculating profitability', () => {
  const result = extractRevsellerFields({
    asin: 'B000000000',
    productTitle: 'Fallback title',
    productUrl: 'https://www.amazon.com/dp/B000000001',
    panelText: 'ASIN: B000000001 Product Title: Test Item Amazon Price: $19.99 FBA Fees: $5.32 Estimated Profit: $4.67 ROI: 31% BSR: 12,345 Category: Grocery Hazmat: No Meltable: Yes IP Alert: None Variation: No'
  });
  assert.equal(result.asin, 'B000000001');
  assert.equal(result.productTitle, 'Test Item');
  assert.equal(result.currentAmazonPrice, 19.99);
  assert.equal(result.sellingPrice, '$19.99');
  assert.equal(result.fbaFees, '$5.32');
  assert.equal(result.estimatedProfit, '$4.67');
  assert.equal(result.roi, '31%');
  assert.equal(result.hazmatWarning, 'No');
  assert.equal(result.meltableWarning, 'Yes');
  assert.equal(result.ipRestrictionWarnings, 'None');
  assert.equal(result.profitabilitySource, 'RevSeller');
});

test('builds reusable Amazon match query from connector product fields', () => {
  assert.equal(amazonMatchQuery({ brand: 'Brand', productName: 'Product', packageSize: '12 ct', count: '12 pack' }), 'Brand Product 12 ct 12 pack');
  assert.equal(amazonMatchQuery({ asin: 'B000000001' }), 'B000000001');
  assert.equal(amazonMatchQuery({ productUrl: 'https://www.costcobusinessdelivery.com/item' }), '');
});

test('maps Amazon page data into a matching candidate before RevSeller reads', () => {
  const candidate = extractAmazonProductFromPage({ asin: 'B000000001', title: 'Brand Product 12 ct', brand: 'Brand', upc: '000111222333', packageSize: '12 ct', count: '12 ct', price: '$19.99', productUrl: 'https://www.amazon.com/dp/B000000001' });
  assert.equal(candidate.asin, 'B000000001');
  assert.equal(candidate.title, 'Brand Product 12 ct');
  assert.equal(candidate.currentSellingPrice, '$19.99');
});


test('identifies opened Amazon product page URLs without navigating', () => {
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/dp/B000000001'), true);
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/Some-Product/dp/B000000001?th=1'), true);
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/s?k=test'), false);
});
