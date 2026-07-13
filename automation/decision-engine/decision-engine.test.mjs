import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decideProduct, runDecisionEngine } from './decision-engine.mjs';

const config = {
  engineName: 'decision-engine-v1',
  rules: { amazonMinimumMatchConfidence: 80 },
  thresholds: { minimumRoiPercent: 30, minimumProfit: 3, maximumPurchasePrice: 100, maximumBsr: 150000 },
  confidence: { buy: 95, dontBuy: 90, needsReview: 60 }
};

test('returns NEEDS REVIEW when Amazon match confidence is below configured minimum', () => {
  const decision = decideProduct({}, { discovery: { matchScore: 79 }, revsellerData: { roi: '50%', estimatedProfit: '$10.00', bsr: '1,000' }, config });
  assert.equal(decision.decision, 'NEEDS REVIEW');
  assert.equal(decision.triggeredRule, 'amazon_match_confidence');
});

test('returns NEEDS REVIEW when RevSeller data is missing', () => {
  const decision = decideProduct({}, { discovery: { matchScore: 80 }, revsellerData: null, config });
  assert.equal(decision.decision, 'NEEDS REVIEW');
  assert.equal(decision.triggeredRule, 'revseller_data_missing');
});

test('uses configurable thresholds to return BUY or DON\'T BUY', () => {
  const passing = decideProduct({ lowestPurchasePrice: 20 }, { discovery: { matchScore: 95 }, revsellerData: { roi: '45%', estimatedProfit: '$9.00', bsr: '10,000' }, config });
  assert.equal(passing.decision, 'BUY');
  assert.equal(passing.triggeredRule, 'all_thresholds_passed');

  const failing = decideProduct({ lowestPurchasePrice: 20 }, { discovery: { matchScore: 95 }, revsellerData: { roi: '20%', estimatedProfit: '$9.00', bsr: '10,000' }, config });
  assert.equal(failing.decision, "DON'T BUY");
  assert.equal(failing.triggeredRule, 'minimum_roi');
});

test('runDecisionEngine writes artifacts/decision-engine/decision-report.json shaped report', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'decision-engine-'));
  const configPath = path.join(tempRoot, 'decision-config.json');
  const mainPath = path.join(tempRoot, 'final-shopping-list.json');
  const amazonPath = path.join(tempRoot, 'product-discovery.json');
  const revsellerPath = path.join(tempRoot, 'revseller-analysis-report.json');
  const outputPath = path.join(tempRoot, 'artifacts', 'decision-engine', 'decision-report.json');

  await writeFile(configPath, JSON.stringify(config));
  await writeFile(mainPath, JSON.stringify([{ brand: 'Acme', productName: 'Protein Bars', packageSize: '24 ct', lowestPurchasePrice: 20 }]));
  await writeFile(amazonPath, JSON.stringify({ discoveries: [{ sourceProduct: { brand: 'Acme', productName: 'Protein Bars', packageSize: '24 ct' }, matched: true, matchScore: 95, amazonProduct: { asin: 'B000BEST22' } }] }));
  await writeFile(revsellerPath, JSON.stringify({ status: 'success', data: { asin: 'B000BEST22', roi: '45%', estimatedProfit: '$9.00', bsr: '10,000' } }));

  try {
    const report = await runDecisionEngine({ configPath, mainBuyingEnginePath: mainPath, amazonDiscoveryPath: amazonPath, revsellerAnalysisPath: revsellerPath, outputPath });
    const written = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(report.firstDecision.decision, 'BUY');
    assert.equal(written.totals.buy, 1);
    assert.equal(written.decisions[0].triggeredRule, 'all_thresholds_passed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});


test('runDecisionEngine uses Profit Analyzer output before RevSeller fallback', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'decision-engine-profit-'));
  const configPath = path.join(tempRoot, 'decision-config.json');
  const mainPath = path.join(tempRoot, 'final-shopping-list.json');
  const amazonPath = path.join(tempRoot, 'product-discovery.json');
  const profitPath = path.join(tempRoot, 'profit-analysis.json');
  const outputPath = path.join(tempRoot, 'decision-report.json');

  await writeFile(configPath, JSON.stringify(config));
  await writeFile(mainPath, JSON.stringify([{ brand: 'Acme', productName: 'Bars', amazonAsin: 'B000PROFIT', lowestPurchasePrice: 20 }]));
  await writeFile(amazonPath, JSON.stringify({ discoveries: [{ sourceProduct: { amazonAsin: 'B000PROFIT' }, matched: true, matchScore: 95, amazonProduct: { asin: 'B000PROFIT' } }] }));
  await writeFile(profitPath, JSON.stringify({ input: { asin: 'B000PROFIT' }, decision: { decision: 'BUY', reasons: ['Profit Analyzer passed'], confidence: 91 }, profitability: { roi: 44 } }));

  try {
    const report = await runDecisionEngine({ configPath, mainBuyingEnginePath: mainPath, amazonDiscoveryPath: amazonPath, profitAnalysisPath: profitPath, revsellerAnalysisPath: path.join(tempRoot, 'missing-revseller.json'), outputPath });
    assert.equal(report.firstDecision.decision, 'BUY');
    assert.equal(report.firstDecision.triggeredRule, 'profit_analyzer_v1');
    assert.equal(report.firstDecision.metrics.roi, 44);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
