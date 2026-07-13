import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConnectorRegistry, toProjectRelativePath } from '../main/run-main-buying-engine.mjs';
import { loadAmazonCatalogFromEnv, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultReviewCandidatesRoot = path.join(repositoryRoot, 'artifacts', 'review-candidates');
export const defaultReviewCandidatesJsonPath = path.join(defaultReviewCandidatesRoot, 'revseller-review-list.json');
export const defaultReviewCandidatesCsvPath = path.join(defaultReviewCandidatesRoot, 'revseller-review-list.csv');

function moneyToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMoney(value) {
  const numeric = moneyToNumber(value);
  return numeric === null ? null : `$${numeric.toFixed(2)}`;
}

function amazonProductUrl(asin, fallbackUrl = null) {
  return fallbackUrl ?? (asin ? `https://www.amazon.com/dp/${asin}` : null);
}

function purchasePrice(product) {
  return formatMoney(product.currentPrice ?? product.price ?? product.purchasePrice ?? product.salePrice);
}

async function readConnectorProducts(connector) {
  if (!existsSync(connector.dealProductsPath)) return [];
  const parsed = JSON.parse(await readFile(connector.dealProductsPath, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${connector.name} deal-products.json must contain an array`);
  return parsed.map((product) => ({ ...product, supplier: product.supplier ?? connector.name, store: product.store ?? connector.name }));
}

export async function loadAvailableStoreProducts(connectors = defaultConnectorRegistry) {
  const products = [];
  const sources = [];
  for (const connector of connectors.filter((entry) => entry.enabled !== false)) {
    const connectorProducts = await readConnectorProducts(connector);
    sources.push({ store: connector.name, path: toProjectRelativePath(connector.dealProductsPath), productCount: connectorProducts.length, available: connectorProducts.length > 0 });
    products.push(...connectorProducts);
  }
  return { products, sources };
}

export function toReviewCandidate(product, amazonCatalog = loadAmazonCatalogFromEnv()) {
  const match = matchProductToAmazon(product, amazonCatalog);
  const hasAmazonCandidate = Boolean(match.amazonAsin);
  const status = match.matched
    ? 'READY_FOR_REVSELLER_REVIEW'
    : hasAmazonCandidate
      ? 'NEEDS_MATCH_REVIEW'
      : 'NO_AMAZON_MATCH';
  const asin = match.amazonAsin;
  return {
    store: product.store ?? product.supplier ?? null,
    storeProductName: product.productName ?? product.title ?? null,
    purchasePrice: purchasePrice(product),
    amazonTitle: match.amazonTitle,
    amazonSellingPrice: match.amazonCurrentSellingPrice,
    asin,
    amazonProductUrl: amazonProductUrl(asin, match.amazonProductUrl),
    matchConfidence: match.confidenceScore,
    matchReason: match.rejectionReason ?? match.matchReason,
    status
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reviewCandidatesToCsv(candidates) {
  const fields = ['store', 'storeProductName', 'purchasePrice', 'amazonTitle', 'amazonSellingPrice', 'asin', 'amazonProductUrl', 'matchConfidence', 'matchReason', 'status'];
  return [fields.join(','), ...candidates.map((candidate) => fields.map((field) => csvEscape(candidate[field])).join(','))].join('\n') + '\n';
}

export async function buildReviewList({ connectors = defaultConnectorRegistry, amazonCatalog = loadAmazonCatalogFromEnv(), jsonPath = defaultReviewCandidatesJsonPath, csvPath = defaultReviewCandidatesCsvPath } = {}) {
  const { products, sources } = await loadAvailableStoreProducts(connectors);
  const candidates = products.map((product) => toReviewCandidate(product, amazonCatalog));
  const report = {
    engine: 'revseller-review-candidates-v1',
    generatedAt: new Date().toISOString(),
    requirements: { calculatesAmazonFees: false, calculatesProfit: false, calculatesRoi: false, usesSpApi: false, usesRevsellerAutomation: false, cartCheckoutOrPurchase: false },
    totals: {
      inputProducts: products.length,
      readyForRevsellerReview: candidates.filter((candidate) => candidate.status === 'READY_FOR_REVSELLER_REVIEW').length,
      needsMatchReview: candidates.filter((candidate) => candidate.status === 'NEEDS_MATCH_REVIEW').length,
      noAmazonMatch: candidates.filter((candidate) => candidate.status === 'NO_AMAZON_MATCH').length
    },
    sources,
    candidates
  };
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(csvPath, reviewCandidatesToCsv(candidates));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await buildReviewList();
  console.log(`Review list complete: ${report.totals.readyForRevsellerReview} ready, ${report.totals.needsMatchReview} need review, ${report.totals.noAmazonMatch} no match.`);
  console.log(`Wrote ${toProjectRelativePath(defaultReviewCandidatesJsonPath)}`);
  console.log(`Wrote ${toProjectRelativePath(defaultReviewCandidatesCsvPath)}`);
}
