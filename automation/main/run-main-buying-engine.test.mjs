import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeProducts } from './run-main-buying-engine.mjs';

const bjs = { id: 'bjs', name: "BJ's Wholesale Club" };
const costco = { id: 'costco_business_center', name: 'Costco Business Center' };

test('mergeProducts deduplicates by UPC and keeps all offers while marking the lowest purchase price', () => {
  const [product] = mergeProducts([
    { connector: bjs, product: { supplier: bjs.name, upc: '12345', brand: 'Acme', productName: 'Protein Bar', packageSize: '24 ct', currentPrice: '$19.99' } },
    { connector: costco, product: { supplier: costco.name, upc: '12345', brand: 'Acme', productName: 'Protein Bar', packageSize: '24 ct', currentPrice: '$17.49' } }
  ]);

  assert.equal(product.offerCount, 2);
  assert.equal(product.storeCount, 2);
  assert.equal(product.lowestPurchasePriceDisplay, '$17.49');
  assert.deepEqual(product.lowestPurchaseStores, ['Costco Business Center']);
  assert.equal(product.offers.find((offer) => offer.storeId === 'costco_business_center').isLowestPurchasePrice, true);
});

test('mergeProducts falls back to brand, product name, and package size when UPC is missing', () => {
  const products = mergeProducts([
    { connector: bjs, product: { brand: 'Acme ', productName: '  Mixed Nuts', packageSize: '30 oz', currentPrice: '$8.99' } },
    { connector: costco, product: { brand: 'acme', productName: 'Mixed   Nuts', packageSize: '30 OZ', currentPrice: '$9.49' } },
    { connector: costco, product: { brand: 'Different', productName: 'Mixed Nuts', packageSize: '30 oz', currentPrice: '$7.49' } }
  ]);

  assert.equal(products.length, 2);
  assert.equal(products.find((product) => product.brand === 'Acme ')?.offerCount, 2);
});
