import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultConfigPath = path.join(repositoryRoot, 'config', 'decision-engine.config.json');
export const defaultMainBuyingEnginePath = path.join(repositoryRoot, 'artifacts', 'main', 'final-shopping-list.json');
export const defaultAmazonDiscoveryPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'product-discovery.json');
export const defaultRevsellerAnalysisPath = path.join(repositoryRoot, 'artifacts', 'revseller', 'revseller-analysis-report.json');
export const defaultDecisionReportPath = path.join(repositoryRoot, 'artifacts', 'decision-engine', 'decision-report.json');

const DECISIONS = Object.freeze({ BUY: 'BUY', DONT_BUY: "DON'T BUY", NEEDS_REVIEW: 'NEEDS REVIEW' });

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function moneyToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function percentToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function rankToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadDecisionConfig(configPath = defaultConfigPath) {
  const config = await readJson(configPath);
  const required = [
    ['rules', 'amazonMinimumMatchConfidence'],
    ['thresholds', 'minimumRoiPercent'],
    ['thresholds', 'minimumProfit'],
    ['thresholds', 'maximumPurchasePrice'],
    ['thresholds', 'maximumBsr'],
    ['confidence', 'buy'],
    ['confidence', 'dontBuy'],
    ['confidence', 'needsReview']
  ];
  for (const [section, key] of required) {
    if (!Number.isFinite(Number(config?.[section]?.[key]))) throw new Error(`Decision config missing numeric ${section}.${key}`);
  }
  return config;
}

function productKey(product) {
  const asin = clean(product.amazonAsin ?? product.asin);
  if (asin) return `asin:${asin.toUpperCase()}`;
  const upc = clean(product.upc);
  if (upc) return `upc:${upc}`;
  return `name:${normalized([product.brand, product.productName ?? product.product, product.packageSize].filter(Boolean).join('|'))}`;
}

function sourceProductFromDiscovery(discovery) {
  return discovery?.sourceProduct ?? discovery?.product ?? {};
}

function amazonProductFromDiscovery(discovery) {
  return discovery?.amazonProduct ?? discovery?.match ?? {};
}

function buildDiscoveryIndex(discoveryReport) {
  const index = new Map();
  for (const discovery of discoveryReport?.discoveries ?? []) {
    const source = sourceProductFromDiscovery(discovery);
    const amazon = amazonProductFromDiscovery(discovery);
    const entries = [productKey(source), productKey({ asin: amazon.asin ?? amazon.amazonAsin }), productKey({ ...source, amazonAsin: amazon.asin ?? amazon.amazonAsin })];
    for (const key of entries.filter((entry) => !entry.endsWith(':') && entry !== 'name:')) index.set(key, discovery);
  }
  return index;
}

function normalizeRevsellerReports(revsellerInput) {
  if (Array.isArray(revsellerInput)) return revsellerInput;
  if (Array.isArray(revsellerInput?.analyses)) return revsellerInput.analyses;
  if (Array.isArray(revsellerInput?.reports)) return revsellerInput.reports;
  if (revsellerInput?.data) return [revsellerInput];
  return [];
}

function buildRevsellerIndex(revsellerInput) {
  const index = new Map();
  for (const report of normalizeRevsellerReports(revsellerInput)) {
    const data = report.data ?? report;
    for (const key of [productKey(data), productKey({ asin: data.asin ?? data.amazonAsin })].filter((entry) => !entry.endsWith(':') && entry !== 'name:')) index.set(key, data);
  }
  return index;
}

function findByProduct(index, product, extra = {}) {
  const keys = [productKey({ ...product, ...extra }), productKey(product), productKey(extra)];
  return keys.map((key) => index.get(key)).find(Boolean) ?? null;
}

function discoveryConfidence(discovery) {
  return Number(discovery?.matchScore ?? discovery?.match?.confidenceScore ?? discovery?.confidenceScore ?? (discovery?.matched ? 100 : 0));
}

function firstFailedThreshold(metrics, thresholds) {
  if (metrics.roiPercent !== null && metrics.roiPercent < Number(thresholds.minimumRoiPercent)) return { rule: 'minimum_roi', reason: `ROI ${metrics.roiPercent}% is below minimum ${thresholds.minimumRoiPercent}%` };
  if (metrics.profit !== null && metrics.profit < Number(thresholds.minimumProfit)) return { rule: 'minimum_profit', reason: `Profit $${metrics.profit.toFixed(2)} is below minimum $${Number(thresholds.minimumProfit).toFixed(2)}` };
  if (metrics.purchasePrice !== null && metrics.purchasePrice > Number(thresholds.maximumPurchasePrice)) return { rule: 'maximum_purchase_price', reason: `Purchase price $${metrics.purchasePrice.toFixed(2)} exceeds maximum $${Number(thresholds.maximumPurchasePrice).toFixed(2)}` };
  if (metrics.bsr !== null && metrics.bsr > Number(thresholds.maximumBsr)) return { rule: 'maximum_bsr', reason: `BSR ${metrics.bsr} exceeds maximum ${thresholds.maximumBsr}` };
  return null;
}

export function decideProduct(product, { discovery, revsellerData, config }) {
  const amazonConfidence = discoveryConfidence(discovery);
  if (amazonConfidence < Number(config.rules.amazonMinimumMatchConfidence)) {
    return { decision: DECISIONS.NEEDS_REVIEW, reason: `Amazon match confidence ${amazonConfidence} is below required ${config.rules.amazonMinimumMatchConfidence}`, triggeredRule: 'amazon_match_confidence', confidence: Number(config.confidence.needsReview) };
  }
  if (!revsellerData) {
    return { decision: DECISIONS.NEEDS_REVIEW, reason: 'RevSeller data is missing', triggeredRule: 'revseller_data_missing', confidence: Number(config.confidence.needsReview) };
  }

  const metrics = {
    roiPercent: percentToNumber(revsellerData.roi ?? product.roi),
    profit: moneyToNumber(revsellerData.estimatedProfit ?? product.estimatedProfit),
    purchasePrice: moneyToNumber(product.lowestPurchasePrice ?? product.purchasePrice ?? product.currentPrice ?? product.price),
    bsr: rankToNumber(revsellerData.bsr ?? revsellerData.rank)
  };
  const failedThreshold = firstFailedThreshold(metrics, config.thresholds);
  if (failedThreshold) return { decision: DECISIONS.DONT_BUY, reason: failedThreshold.reason, triggeredRule: failedThreshold.rule, confidence: Number(config.confidence.dontBuy), metrics };
  return { decision: DECISIONS.BUY, reason: 'All configured decision thresholds passed', triggeredRule: 'all_thresholds_passed', confidence: Number(config.confidence.buy), metrics };
}

export async function runDecisionEngine({ configPath = defaultConfigPath, mainBuyingEnginePath = defaultMainBuyingEnginePath, amazonDiscoveryPath = defaultAmazonDiscoveryPath, revsellerAnalysisPath = defaultRevsellerAnalysisPath, outputPath = defaultDecisionReportPath } = {}) {
  const config = await loadDecisionConfig(configPath);
  const products = existsSync(mainBuyingEnginePath) ? await readJson(mainBuyingEnginePath) : [];
  const amazonDiscovery = existsSync(amazonDiscoveryPath) ? await readJson(amazonDiscoveryPath) : { discoveries: [] };
  const revsellerAnalysis = existsSync(revsellerAnalysisPath) ? await readJson(revsellerAnalysisPath) : null;
  const discoveryIndex = buildDiscoveryIndex(amazonDiscovery);
  const revsellerIndex = buildRevsellerIndex(revsellerAnalysis);
  const decisions = products.map((product) => {
    const discovery = findByProduct(discoveryIndex, product);
    const amazon = amazonProductFromDiscovery(discovery);
    const revsellerData = findByProduct(revsellerIndex, product, { asin: amazon.asin ?? product.amazonAsin });
    return { product, amazonDiscovery: discovery ?? null, revsellerData, ...decideProduct(product, { discovery, revsellerData, config }) };
  });
  const report = {
    engine: config.engineName,
    generatedAt: new Date().toISOString(),
    configPath: path.relative(repositoryRoot, configPath),
    inputs: { mainBuyingEngine: path.relative(repositoryRoot, mainBuyingEnginePath), amazonProductDiscovery: path.relative(repositoryRoot, amazonDiscoveryPath), revsellerAnalysis: path.relative(repositoryRoot, revsellerAnalysisPath) },
    totals: { products: decisions.length, buy: decisions.filter((entry) => entry.decision === DECISIONS.BUY).length, dontBuy: decisions.filter((entry) => entry.decision === DECISIONS.DONT_BUY).length, needsReview: decisions.filter((entry) => entry.decision === DECISIONS.NEEDS_REVIEW).length },
    firstDecision: decisions[0] ?? null,
    decisions
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await runDecisionEngine();
  console.log(`Decision Engine v1 complete: ${report.totals.buy} BUY, ${report.totals.dontBuy} DON'T BUY, ${report.totals.needsReview} NEEDS REVIEW.`);
  console.log(`Wrote ${path.relative(repositoryRoot, defaultDecisionReportPath)}`);
}
