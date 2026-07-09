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
  const expectedPrices = new Map([
    ['$7.50', '$7.50'],
    ['$23.19', '$23.19'],
    ['$43.99', '$43.99'],
    ['$1,249.99', '$1249.99']
  ]);

  for (const [input, expected] of expectedPrices) {
    assert.equal(normalizeCostcoMoney(input), expected);
  }

  assert.deepEqual(Array.from(extractCostcoPrices('Prices: $7.50 $23.19 $43.99 $1,249.99')), [...expectedPrices.values()]);
  assert.deepEqual(Array.from(extractCostcoPrices('Instant Savings $7 50 Original $10 99')), ['$7.50', '$10.99']);
  assert.equal(normalizeCostcoMoney('$750'), '$7.50');
});
