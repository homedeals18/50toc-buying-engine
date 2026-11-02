import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeJson } from './listing-network-diagnostic.mjs';

test('identifies product arrays and reports requested field groups', () => {
  const analysis = analyzeJson({
    totalResults: 2,
    clubId: '123',
    products: [
      { productId: '1', productName: 'One', salePrice: 4.99, upc: '012345678905', pickupAvailability: true },
      { productId: '2', productName: 'Two', salePrice: 5.99, gtin: '00012345678905', pickupAvailability: false }
    ]
  });

  assert.equal(analysis.productArrays.length, 1);
  assert.equal(analysis.productArrays[0].arrayLength, 2);
  assert.deepEqual(analysis.productArrays[0].fields.upcGtin, ['gtin', 'upc']);
  assert.ok(analysis.fields.pagination.includes('totalResults'));
  assert.ok(analysis.fields.club.includes('clubId'));
});

test('does not classify unrelated arrays as products', () => {
  assert.deepEqual(analyzeJson({ navigation: [{ name: 'Grocery', url: '/category/grocery' }] }).productArrays, []);
});
