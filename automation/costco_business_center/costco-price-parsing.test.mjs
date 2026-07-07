import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { costcoPriceParsingSource } from './costco-price-parsing.mjs';

function loadPriceHelpers() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${costcoPriceParsingSource()}; globalThis.normalizeCostcoMoney = normalizeCostcoMoney; globalThis.extractCostcoPrices = extractCostcoPrices;`, context);
  return context;
}

test('Costco price parsing source compiles and normalizes common prices', () => {
  const { normalizeCostcoMoney, extractCostcoPrices } = loadPriceHelpers();
  for (const price of ['$7.50', '$23.19', '$43.99', '$1,249.99']) {
    assert.equal(normalizeCostcoMoney(price), price.replace(',', ''));
  }
  assert.deepEqual(Array.from(extractCostcoPrices('Prices: $7.50 $23.19 $43.99 $1,249.99')), ['$7.50', '$23.19', '$43.99', '$1249.99']);
});
