import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDiscountEvidence } from './discount-evidence.mjs';
import { dealHasVerifiedDiscount } from './deal-filter.js';

test('unlabeled second prices and promotional badges are not original-price evidence', () => {
  for (const text of ['Clearance $9.99 $35 free shipping', 'Wow Deals $9.99 $0.50 per oz', '$9.99 Save $0.00', '$9.99 Coupons Ask Bev']) {
    const evidence = extractDiscountEvidence(text);
    assert.equal(evidence.originalPrice, null);
    assert.equal(dealHasVerifiedDiscount({ currentPrice: '$9.99', ...evidence }), false, text);
  }
});

test('labeled original prices and complete numeric discounts survive extraction', () => {
  for (const text of ['Now $9.99 Was $12.99', '$9.99 Original Price: $12.99', '$9.99 Regular $12.99', '$9.99 Save $3.50', '$9.99 20.5% off', '$9.99 0.5% off']) {
    assert.equal(dealHasVerifiedDiscount({ currentPrice: '$9.99', ...extractDiscountEvidence(text) }), true, text);
  }
});

test('extraction does not turn malformed or impossible evidence into a valid discount', () => {
  for (const text of ['Save 20 rewards points', 'Save $0.001', '-20% off', '120% off', '0% off', '100% off']) {
    assert.equal(dealHasVerifiedDiscount({ currentPrice: '$9.99', ...extractDiscountEvidence(text) }), false, text);
  }
});
