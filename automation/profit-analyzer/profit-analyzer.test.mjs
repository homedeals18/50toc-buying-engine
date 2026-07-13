import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { analyzeProfit, calculateProfitability, decideProfitAnalysis, parseFees, parsePricing, runProfitAnalyzer } from './profit-analyzer.mjs';

test('calculateProfitability applies profit, ROI, net proceeds, and max cost formulas', () => {
  const result = calculateProfitability({ sellingPrice: 100, estimatedAmazonFees: 25, purchaseCost: 40, inboundShipping: 3, prepCost: 2, minimumTargetRoi: 50 });
  assert.equal(result.netProceeds, 75);
  assert.equal(result.totalLandedCost, 45);
  assert.equal(result.estimatedProfit, 30);
  assert.equal(result.roi, 66.67);
  assert.equal(result.maxLandedCost, 50);
  assert.equal(result.maxPurchaseCost, 45);
});

test('calculateProfitability marks missing required formula inputs without inventing data', () => {
  const result = calculateProfitability({ sellingPrice: null, estimatedAmazonFees: 5, purchaseCost: 10, inboundShipping: 1, prepCost: 0, minimumTargetRoi: 30 });
  assert.deepEqual(result.missingData, ['sellingPrice']);
  assert.equal(result.netProceeds, null);
  assert.equal(result.estimatedProfit, null);
  assert.equal(result.roi, null);
  assert.equal(result.maxPurchaseCost, null);
});

test('decideProfitAnalysis returns BUY, DON\'T_BUY, or NEEDS_REVIEW from formula and restriction data', () => {
  const buy = decideProfitAnalysis({ profitability: { roi: 40, minimumTargetRoi: 30, missingData: [] }, restrictions: { canSell: true }, pricing: {}, fees: {} });
  assert.equal(buy.decision, 'BUY');

  const dontBuy = decideProfitAnalysis({ profitability: { roi: 10, minimumTargetRoi: 30, missingData: [] }, restrictions: { canSell: true }, pricing: {}, fees: {} });
  assert.equal(dontBuy.decision, "DON'T_BUY");

  const review = decideProfitAnalysis({ profitability: { roi: null, minimumTargetRoi: 30, missingData: ['sellingPrice'] }, restrictions: { canSell: true }, pricing: {}, fees: {} });
  assert.equal(review.decision, 'NEEDS_REVIEW');
});

test('parsePricing and parseFees normalize SP-API responses used by calculations', () => {
  const pricing = parsePricing({ payload: [{ CompetitivePricing: { CompetitivePrices: [{ Price: { LandedPrice: { Amount: 88.49 } } }] }, Summary: { BuyBoxPrices: [{ LandedPrice: { Amount: 89.99 } }], TotalOfferCount: 7 } }] });
  assert.equal(pricing.currentCompetitiveSellingPrice, 88.49);
  assert.equal(pricing.featuredOfferPrice, 89.99);
  assert.equal(pricing.offerCount, 7);

  const fees = parseFees({ payload: { FeesEstimateResult: { FeesEstimate: { TotalFeesEstimate: { Amount: 22.34 }, FeeDetailList: [{ FeeType: 'ReferralFee', FeeAmount: { Amount: 12.34 } }, { FeeType: 'FBAFees', FeeAmount: { Amount: 10 } }] } } } });
  assert.equal(fees.referralFee, 12.34);
  assert.equal(fees.fbaFulfillmentFee, 10);
  assert.equal(fees.totalEstimatedAmazonFees, 22.34);
});

test('analyzeProfit returns precise missing authorization error for success-criteria ASIN when env is absent', async () => {
  const analysis = await analyzeProfit({ asin: 'B0FX3DY3C7', marketplace: 'US', purchaseCost: 43.19, fulfillmentMethod: 'FBA', inboundShipping: 0, minimumTargetRoi: 30 });
  assert.equal(analysis.decision.decision, 'NEEDS_REVIEW');
  assert.equal(analysis.auth.status, 'missing_authorization');
  assert.ok(analysis.auth.missingEnvironmentVariables.includes('SP_API_CLIENT_ID'));
});

test('runProfitAnalyzer accepts Amazon Product Discovery output and writes profit-analysis.json', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'profit-analyzer-'));
  const inputPath = path.join(tempRoot, 'product-discovery.json');
  const outputPath = path.join(tempRoot, 'profit-analysis.json');
  await writeFile(inputPath, JSON.stringify({ discoveries: [{ sourceProduct: { lowestPurchasePrice: 43.19 }, amazonProduct: { asin: 'B0FX3DY3C7' } }] }));
  try {
    const analysis = await runProfitAnalyzer({ inputPath, outputPath });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(analysis.input.asin, 'B0FX3DY3C7');
    assert.equal(written.engine, '50toc-profit-analyzer-v1');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
