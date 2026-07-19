import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBjsPrice } from './price-utils.mjs';

test('normalizes BJ compact dollar and cent rendering', () => {
  assert.equal(normalizeBjsPrice('$898'), '$8.98');
  assert.equal(normalizeBjsPrice('$1098'), '$10.98');
  assert.equal(normalizeBjsPrice('$8498'), '$84.98');
  assert.equal(normalizeBjsPrice('$3999'), '$39.99');
});

test('preserves and standardizes ordinary prices', () => {
  assert.equal(normalizeBjsPrice('$1.00'), '$1.00');
  assert.equal(normalizeBjsPrice('19.98'), '$19.98');
  assert.equal(normalizeBjsPrice(7.5), '$7.50');
  assert.equal(normalizeBjsPrice(null), null);
});
