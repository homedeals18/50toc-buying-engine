import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateListingProduct, mergeDuplicateProducts, productIdentity } from './deal-filter.js';

test('rejects unrelated departments before product page', () => {
  for (const word of ['Furniture', 'Garden', 'Toys', 'Electronics', 'Mattresses', 'Patio']) {
    assert.equal(evaluateListingProduct({ productName: `${word} Deal`, category: word }).accepted, false);
  }
});

test('rejects variety assorted mixed flavor and sampler products before product page', () => {
  assert.equal(evaluateListingProduct({ productName: 'Mixed Flavor Chips' }).accepted, false);
  assert.equal(evaluateListingProduct({ productName: 'Variety Pack' }).accepted, false);
  assert.equal(evaluateListingProduct({ productName: 'Assorted Candy' }).accepted, false);
  assert.equal(evaluateListingProduct({ productName: 'Cookie Sampler' }).accepted, false);
  assert.equal(evaluateListingProduct({ productName: 'Snack Variety Pack' }).accepted, false);
});

test('accepts normal pack and peanut butter products', () => {
  assert.equal(evaluateListingProduct({ productName: 'Peanut Butter Crackers', category: 'Grocery' }).accepted, true);
  assert.equal(evaluateListingProduct({ productName: 'Blue Diamond Almonds 24 Pack', category: 'Grocery' }).accepted, true);
  assert.equal(evaluateListingProduct({ productName: 'Skippy Peanut Butter 2 Pack', category: 'Grocery' }).accepted, true);
});

test('deduplicates by UPC before SKU and URL', () => {
  const result = mergeDuplicateProducts([
    { productName: 'A', upc: '123', sku: 'sku-1', productUrl: 'https://example.com/1', store: { storeName: 'One', storeNumber: '1', price: '$1' } },
    { productName: 'A again', upc: '123', sku: 'sku-2', productUrl: 'https://example.com/2', store: { storeName: 'Two', storeNumber: '2', price: '$1' } }
  ]);
  assert.equal(result.products.length, 1);
  assert.equal(result.duplicatesMerged, 1);
  assert.equal(result.products[0].stores.length, 2);
  assert.equal(productIdentity(result.products[0]), 'upc:123');
});
