import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryAllowed, evaluateListingProduct, mergeDuplicateProducts, productIdentity } from './deal-filter.js';

test('rejects unrelated departments before product page', () => {
  for (const word of ['Furniture', 'Garden', 'Toys', 'Electronics', 'Mattresses', 'Patio']) {
    assert.equal(evaluateListingProduct({ productName: `${word} Deal`, category: word }).accepted, false);
  }
});


test('rejects requested appliances furniture batteries and electronics keywords before product page', () => {
  const keywords = [
    'appliance', 'appliances', 'kitchen appliance', 'home appliance', 'cooker', 'slow cooker', 'multi cooker',
    'blender', 'microwave', 'air fryer', 'toaster', 'vacuum', 'fan', 'heater', 'refrigerator', 'freezer',
    'washer', 'dryer', 'coffee maker', 'mattress', 'sofa', 'sectional', 'recliner', 'chair', 'furniture',
    'battery', 'batteries', 'electronics', 'TV', 'television', 'soundbar', 'audio',
    'volleyball', 'badminton', 'lawn game', 'seating set', 'dining set', 'deck tile', 'spatula',
    'grill accessory', 'fridge', 'mini fridge', 'AirPods', 'headphones', 'Nintendo', 'video game',
    'console', 'gaming', 'outdoor play', 'patio dining'
  ];
  for (const keyword of keywords) {
    const result = evaluateListingProduct({ productName: `Brand ${keyword} Deal` });
    assert.equal(result.accepted, false, keyword);
    assert.equal(result.signal, 'product name', keyword);
  }
});

test('reports exact listing signal and matched text for prefilter rejections', () => {
  assert.deepEqual(
    evaluateListingProduct({ productName: 'Safe Snack', listingText: 'Energizer MAX AA Batteries 48 ct' }),
    { accepted: false, reason: 'rejected-unrelated-department', matched: 'Batteries', signal: 'tile text' }
  );
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', productUrl: 'https://www.bjs.com/product/kitchen-appliance-deal/1' }).signal, 'product URL');
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', imageAltText: 'Compact microwave' }).signal, 'image alt text');
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', categoryText: 'TVs and Electronics' }).signal, 'category text');
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', ariaLabels: 'Open product details for sectional sofa' }).signal, 'aria labels');
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', breadcrumbText: 'Home / Furniture / Recliners' }).signal, 'breadcrumb/category metadata');
  assert.equal(evaluateListingProduct({ productName: 'Safe Snack', categoryMetadata: 'home appliance' }).signal, 'breadcrumb/category metadata');
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

test('rejects fresh produce by product name when category metadata is missing', () => {
  assert.equal(categoryAllowed({ productName: 'Wellsley Farms Hass Avocados, 5 ct.', category: null }), false);
  assert.equal(categoryAllowed({ productName: 'Shelf-Stable Avocado Oil, 1 L', category: 'Grocery' }), true);
});
