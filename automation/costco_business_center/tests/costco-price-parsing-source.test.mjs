import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costcoPriceParsingSource } from '../costco-price-parsing-source.js';

function loadPriceParser() {
  const parser = {};
  Function('parser', `${costcoPriceParsingSource()}; parser.normalizeCostcoMoney = normalizeCostcoMoney; parser.extractCostcoPrices = extractCostcoPrices; parser.extractCostcoDiscount = extractCostcoDiscount; parser.extractCostcoCoupon = extractCostcoCoupon;`)(parser);
  return parser;
}

test('Costco price parser evaluates without invalid regular expressions', () => {
  assert.doesNotThrow(() => loadPriceParser());
});

test('Costco price parser extracts decimal and comma prices without dropping cents', () => {
  const { extractCostcoPrices } = loadPriceParser();
  assert.deepEqual(extractCostcoPrices('Sale prices $7.50 $23.19 $43.99 $1,249.99'), ['$7.50', '$23.19', '$43.99', '$1249.99']);
});

test('Costco price normalizer keeps explicit decimals as dollars and cents', () => {
  const { normalizeCostcoMoney } = loadPriceParser();
  assert.equal(normalizeCostcoMoney('$7.50'), '$7.50');
  assert.notEqual(normalizeCostcoMoney('$7.50'), '$750.00');
});
