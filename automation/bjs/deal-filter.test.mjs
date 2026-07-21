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

test('rejects observed BJ fresh produce and refrigerated lemonade names', () => {
  for (const productName of [
    'Cherries, 2 lbs.',
    'Nectarines, 4 lbs.',
    'Seedless Watermelon, 1 ct.',
    'Chiquita Organic Bananas, 2 lbs.',
    'Wellsley Farms Fresh Gourmet Carrots, 2 pk./1 lb.',
    'Seedless Green Grapes, 3 lbs.',
    'Wellsley Farms Vidalia Sweet Onions, 5 lbs.',
    'Wellsley Farms Organic Baby Cut Carrots, 2 lbs.',
    'Angel Sweet Grape Tomatoes, 2 lbs.',
    'Wellsley Farms English Seedless Cucumbers, 2 ct.',
    'Simply Lemonade with Raspberry, Bottles, 3 pk./52 fl. oz.'
  ]) {
    assert.equal(categoryAllowed({ productName, category: 'Grocery' }), false, productName);
  }
});

test('rejects housewares without confusing lemon or oatmilk words for produce', () => {
  assert.equal(categoryAllowed({ productName: 'Artstyle Lemon Twist Summer Plates', category: 'Grocery' }), false);
  assert.equal(categoryAllowed({ productName: 'Contigo Travel Mug - Licorice & Oatmilk', category: 'Grocery' }), false);
  assert.equal(categoryAllowed({ productName: 'Lemon Scent Dish Soap', category: 'Health & Household' }), true);
  assert.equal(categoryAllowed({ productName: 'Oatmilk Shampoo', category: 'Health & Beauty' }), true);
  assert.equal(categoryAllowed({ productName: 'Shark Air Purifier - White', category: 'Health & Household' }), false);
});


test('rejects every Berkley Jensen product regardless of category', () => {
  for (const productName of [
    'Berkley Jensen 27-Gal. Storage Box',
    'Berkley Jensen Peanut Butter Crackers',
    'Berkley Jensen Household Cleaning Wipes'
  ]) {
    assert.equal(evaluateListingProduct({ productName, category: 'Grocery' }).accepted, false, productName);
    assert.equal(categoryAllowed({ productName, category: 'Grocery' }), false, productName);
  }
});

test('rejects observed out-of-scope housewares before product-page evaluation and during repair', () => {
  const names = [
    'Artstyle Lemon Twist Summer 12" Oval Plates, 50 ct.',
    "Artstyle 'Lemon Twist' Summer Premium Dinner Napkins, 100 ct.",
    'Bentgo Food Storage 4-Pc. Container Set',
    'Ello Plastic 10-Pc. Meal Prep Storage Container Set',
    'GreenPan Rio 10-Pc. Aluminum Cookware Set',
    'Sur La Table Chamberlin Folding Acacia Wood Tray',
    'Cirkul Stainless Steel Water Bottle Starter Kit, 22 oz.',
    'Graco Travel Lite Portable Bassinet',
    'Midea Smart 8,000 BTU Window Air Conditioner',
    'Calpak Quantum Large Checked Suitcase',
    "$25 BJ's Gift Card"
  ];
  for (const productName of names) {
    assert.equal(evaluateListingProduct({ productName }).accepted, false, productName);
    assert.equal(categoryAllowed({ productName, category: 'Grocery' }), false, productName);
  }
});


test('rejects every Wellsley Farms product regardless of category', () => {
  for (const productName of [
    'Wellsley Farms Peanut Butter Crackers',
    'Wellsley Farms Infant Formula',
    'Wellsley Farms Paper Towels'
  ]) {
    assert.equal(evaluateListingProduct({ productName, category: 'Grocery' }).accepted, false, productName);
    assert.equal(categoryAllowed({ productName, category: 'Grocery' }), false, productName);
  }
});
