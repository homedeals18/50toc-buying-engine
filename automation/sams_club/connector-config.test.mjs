import assert from 'node:assert/strict';
import { test } from 'node:test';
import { samsClubConnectorConfig as config } from './connector-config.mjs';

test('Sam\'s Club connector defaults to the first 10 clearance products and no commerce actions', () => {
  assert.equal(config.maxProducts, 10);
  assert.equal(config.dealSource.name, 'Clearance');
  assert.equal(config.clubLocation, 'Secaucus, NJ 07094');
  assert.deepEqual(config.noCommerceActions, {
    login: false,
    password: false,
    membershipAuthentication: false,
    addToCart: false,
    checkout: false,
    purchase: false
  });
});

test('Sam\'s Club category filters keep relevant dry goods and reject excluded departments', () => {
  assert.equal(config.relevantCategoryPatterns.some((pattern) => pattern.test('Dry Grocery')), true);
  assert.equal(config.relevantCategoryPatterns.some((pattern) => pattern.test('Office')), true);
  assert.equal(config.excludedCategoryPattern.test('Frozen dairy milk'), true);
  assert.equal(config.excludedCategoryPattern.test('Patio garden furniture'), true);
});
