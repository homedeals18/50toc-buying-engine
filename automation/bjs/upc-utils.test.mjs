import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractGtinCandidatesFromObject,
  extractGtinCandidatesNearIdentity,
  extractLabeledGtinCandidates,
  isValidGtin,
  normalizeGtin
} from './upc-utils.mjs';

test('validates UPC-A EAN-13 and GTIN-14 check digits', () => {
  assert.equal(isValidGtin('036000291452'), true);
  assert.equal(isValidGtin('4006381333931'), true);
  assert.equal(isValidGtin('00036000291452'), true);
  assert.equal(isValidGtin('036000291453'), false);
  assert.equal(normalizeGtin('0 36000-29145 2'), '036000291452');
});

test('extracts GTIN values only from labeled object fields', () => {
  const candidates = extractGtinCandidatesFromObject({
    sku: '351569',
    brand: { name: 'Example' },
    offers: [{ gtin12: '036000291452' }],
    recommendations: [{ upc: '036000291453' }]
  });
  assert.deepEqual(candidates, ['036000291452']);
});

test('extracts labeled UPC near the current product identity', () => {
  const response = '{"sku":"OTHER","upc":"4006381333931"} filler '.repeat(200)
    + '{"sku":"351569","productName":"Target Product","upc":"036000291452"}';
  assert.deepEqual(extractGtinCandidatesNearIdentity(response, ['351569', 'Target Product']), ['036000291452']);
  assert.deepEqual(extractLabeledGtinCandidates('SKU: 351569 UPC: 036000291452'), ['036000291452']);
});
