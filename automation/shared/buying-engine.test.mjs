import assert from 'node:assert/strict';
import { test } from 'node:test';
import { businessRejectionReasons, runBuyingPipeline } from './buying-engine.js';

test('global business filters reject explicit variety terms but keep flavor names', () => {
  assert.deepEqual(businessRejectionReasons({ productName: 'Fruity Rainbow Tropical Berry Peach Vibe Snacks' }), []);
  for (const productName of ['Variety Pack Chips', 'Assorted Cookies', 'Mixed Pack Candy', 'Multi Flavor Bars', 'Flavor Variety Water', 'Sampler Snacks']) {
    assert.ok(businessRejectionReasons({ productName }).some((reason) => /variety|assorted|mixed|sampler/i.test(reason)), productName);
  }
});

test('global business filters reject cold, fresh, dairy, meat, and produce items', () => {
  for (const productName of ['Frozen Pizza', 'Refrigerated Juice', 'Cheese Slices', 'Chicken Breast', 'Fresh Produce Apples']) {
    assert.ok(businessRejectionReasons({ productName }).some((reason) => /Refrigerated|frozen|dairy|meat|produce/i.test(reason)), productName);
  }
});

test('buying pipeline adds Amazon profitability fields and decisions', async () => {
  process.env.AMAZON_LOOKUP_FIXTURES_JSON = JSON.stringify([{ sku: 'SKU-1', amazonSellingPrice: 30, referralFee: 4.5, fbaFee: 5 }]);
  const [product] = await runBuyingPipeline([{ supplier: 'Costco Business Center', productName: 'Berry Snack', sku: 'SKU-1', currentPrice: '$10.00' }]);
  assert.equal(product.amazonSellingPrice, '$30.00');
  assert.equal(product.amazonFees, '$9.50');
  assert.equal(product.estimatedProfit, '$10.50');
  assert.equal(product.roi, '105.00%');
  assert.equal(product.buyingDecision, 'Buy');
});
