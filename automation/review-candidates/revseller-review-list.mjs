import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConnectorRegistry, toProjectRelativePath } from '../main/run-main-buying-engine.mjs';
import { defaultProductDiscoveryPath, defaultAmazonAnalysisPath } from '../shared/amazon-product-discovery.mjs';
import { defaultMatchingReportPath, loadAmazonCatalogFromEnv, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultReviewCandidatesRoot = path.join(repositoryRoot, 'artifacts', 'review-candidates');
export const defaultReviewCandidatesJsonPath = path.join(defaultReviewCandidatesRoot, 'revseller-review-list.json');
export const defaultReviewCandidatesCsvPath = path.join(defaultReviewCandidatesRoot, 'revseller-review-list.csv');

export const defaultAmazonArtifactPaths = Object.freeze({
  productDiscoveryPath: defaultProductDiscoveryPath,
  matchingReportPath: defaultMatchingReportPath,
  amazonAnalysisPath: defaultAmazonAnalysisPath
});

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function digitsOnly(value) {
  return clean(value).replace(/\D/g, '');
}

function normalizedIdentityValue(value) {
  return normalized(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function productIdentityKey(product) {
  const explicit = product.productIdentityKey ?? product.identityKey ?? product.productKey ?? product.sourceProductKey ?? product.sourceProductId ?? product.productId ?? product.id ?? product.itemId ?? product.sku;
  if (clean(explicit)) return `id:${normalizedIdentityValue(explicit)}`;
  return null;
}

function upcIdentityKey(product) {
  const upc = digitsOnly(product.upc ?? product.upcCode ?? product.gtin ?? product.barcode);
  return upc ? `upc:${upc}` : null;
}

function fallbackIdentityKey(product) {
  const brand = normalizedIdentityValue(product.brand);
  const name = normalizedIdentityValue(product.productName ?? product.title ?? product.name);
  const size = normalizedIdentityValue(product.packageSize ?? product.size ?? product.unitSize ?? product.count ?? product.packageCount);
  return brand && name && size ? `fallback:${brand}|${name}|${size}` : null;
}

function identityKeys(product) {
  return [productIdentityKey(product), upcIdentityKey(product), fallbackIdentityKey(product)].filter(Boolean);
}

function normalizeExistingAmazonProduct(product = {}) {
  const asin = clean(product.asin ?? product.amazonAsin) || null;
  return {
    ...product,
    asin,
    title: clean(product.title ?? product.amazonTitle ?? product.productTitle ?? product.productName) || null,
    currentSellingPrice: formatMoney(product.currentSellingPrice ?? product.amazonCurrentSellingPrice ?? product.amazonSellingPrice ?? product.currentPrice ?? product.price),
    productUrl: product.productUrl ?? product.amazonProductUrl ?? amazonProductUrl(asin)
  };
}

function artifactMatchFromDiscovery(entry) {
  if (!entry?.amazonProduct?.asin && !entry?.amazonAsin) return null;
  const amazonProduct = normalizeExistingAmazonProduct(entry.amazonProduct ?? entry);
  return {
    sourceProduct: entry.sourceProduct ?? entry.storeProduct ?? entry.product ?? null,
    amazonProduct,
    asin: amazonProduct.asin,
    confidenceScore: entry.matchScore ?? entry.confidenceScore ?? 0,
    matchReason: entry.matchReason ?? 'Existing Amazon Product Discovery match',
    matched: entry.matched ?? true,
    source: 'product-discovery'
  };
}

function artifactMatchFromMatchingReport(entry) {
  if (!entry?.amazonAsin && !entry?.amazonProduct?.asin) return null;
  const amazonProduct = normalizeExistingAmazonProduct(entry.amazonProduct ?? {
    asin: entry.amazonAsin,
    title: entry.amazonTitle,
    currentSellingPrice: entry.amazonCurrentSellingPrice,
    productUrl: entry.amazonProductUrl
  });
  return {
    sourceProduct: entry.sourceProduct ?? entry.storeProduct ?? entry.product ?? null,
    amazonProduct,
    asin: amazonProduct.asin,
    confidenceScore: entry.confidenceScore ?? 0,
    matchReason: entry.rejectionReason ?? entry.matchReason ?? 'Existing Amazon Matching Engine match',
    matched: entry.matched ?? false,
    needsReview: entry.needsReview,
    source: 'matching-report'
  };
}

function artifactMatchFromAnalysis(report) {
  if (!report?.storeProduct || !report?.amazonProduct?.asin) return null;
  const amazonProduct = normalizeExistingAmazonProduct({ ...report.amazonProduct, currentSellingPrice: report.amazonProduct.currentSellingPrice ?? report.amazonProduct.currentPrice });
  return {
    sourceProduct: report.storeProduct,
    amazonProduct,
    asin: amazonProduct.asin,
    confidenceScore: report.matchScore ?? report.confidenceScore ?? 0,
    matchReason: report.matchReason ?? 'Existing Amazon Analysis match',
    matched: report.matched ?? true,
    needsReview: report.needsReview,
    source: 'amazon-analysis'
  };
}

function collectAmazonAnalysisMatches(value, matches = []) {
  if (!value || typeof value !== 'object') return matches;
  const directMatch = artifactMatchFromAnalysis(value);
  if (directMatch) matches.push(directMatch);
  if (Array.isArray(value)) {
    for (const entry of value) collectAmazonAnalysisMatches(entry, matches);
    return matches;
  }
  for (const key of ['analyses', 'analysis', 'results', 'matches', 'reports', 'items']) {
    if (value[key]) collectAmazonAnalysisMatches(value[key], matches);
  }
  return matches;
}

async function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadExistingAmazonResults({ productDiscoveryPath = defaultAmazonArtifactPaths.productDiscoveryPath, matchingReportPath = defaultAmazonArtifactPaths.matchingReportPath, amazonAnalysisPath = defaultAmazonArtifactPaths.amazonAnalysisPath } = {}) {
  const matches = [];
  const discovery = await readJsonIfExists(productDiscoveryPath);
  for (const entry of discovery?.discoveries ?? []) {
    const match = artifactMatchFromDiscovery(entry);
    if (match) matches.push(match);
  }
  const matchingReport = await readJsonIfExists(matchingReportPath);
  for (const entry of matchingReport?.matches ?? []) {
    const match = artifactMatchFromMatchingReport(entry);
    if (match) matches.push(match);
  }
  const analysis = await readJsonIfExists(amazonAnalysisPath);
  matches.push(...collectAmazonAnalysisMatches(analysis));
  return matches;
}

function findExistingAmazonMatch(product, existingAmazonResults = []) {
  const keys = identityKeys(product);
  for (const key of keys) {
    const match = existingAmazonResults.find((entry) => entry.sourceProduct && identityKeys(entry.sourceProduct).includes(key));
    if (match) return match;
  }
  return null;
}

function matchFromExistingResult(product, existingResult) {
  if (!existingResult) return null;
  const verification = matchProductToAmazon(product, [existingResult.amazonProduct]);
  const confidenceScore = existingResult.confidenceScore ?? verification.confidenceScore ?? 0;
  const packSizeVerified = verification.matched && confidenceScore >= 90;
  return {
    matched: packSizeVerified,
    needsReview: !packSizeVerified,
    confidenceScore,
    matchReason: packSizeVerified ? (verification.matchReason ?? existingResult.matchReason) : (verification.rejectionReason ?? existingResult.matchReason ?? 'Existing ASIN match requires pack/size review'),
    rejectionReason: packSizeVerified ? null : (verification.rejectionReason ?? existingResult.matchReason ?? 'Existing ASIN match requires pack/size review'),
    amazonAsin: existingResult.asin,
    amazonTitle: existingResult.amazonProduct.title,
    amazonCurrentSellingPrice: existingResult.amazonProduct.currentSellingPrice,
    amazonProductUrl: existingResult.amazonProduct.productUrl
  };
}

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

export function toReviewCandidate(product, amazonCatalog = loadAmazonCatalogFromEnv(), existingAmazonResults = []) {
  const existingMatch = matchFromExistingResult(product, findExistingAmazonMatch(product, existingAmazonResults));
  const match = existingMatch ?? matchProductToAmazon(product, amazonCatalog);
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


export function toReviewCandidateFromExistingAmazonResult(existingResult) {
  const product = existingResult.sourceProduct ?? {};
  const asin = existingResult.asin ?? existingResult.amazonProduct?.asin ?? null;
  const confidenceScore = existingResult.confidenceScore ?? 0;
  const hasAmazonCandidate = Boolean(asin);
  const status = existingResult.matched && confidenceScore >= 90
    ? 'READY_FOR_REVSELLER_REVIEW'
    : hasAmazonCandidate
      ? 'NEEDS_MATCH_REVIEW'
      : 'NO_AMAZON_MATCH';
  return {
    store: product.store ?? product.supplier ?? product.storeName ?? null,
    storeProductName: product.productName ?? product.title ?? product.name ?? null,
    purchasePrice: purchasePrice(product),
    amazonTitle: existingResult.amazonProduct?.title ?? null,
    amazonSellingPrice: existingResult.amazonProduct?.currentSellingPrice ?? null,
    asin,
    amazonProductUrl: amazonProductUrl(asin, existingResult.amazonProduct?.productUrl),
    matchConfidence: confidenceScore,
    matchReason: existingResult.matchReason ?? null,
    status
  };
}

function candidateKey(candidate) {
  return [normalized(candidate.store), normalized(candidate.storeProductName), normalized(candidate.asin)].join('|');
}

function directAnalysisCandidates(existingAmazonResults) {
  return existingAmazonResults
    .filter((result) => result.source === 'amazon-analysis' && result.sourceProduct && result.amazonProduct)
    .map((result) => toReviewCandidateFromExistingAmazonResult(result));
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

export async function buildReviewList({ connectors = defaultConnectorRegistry, amazonCatalog = loadAmazonCatalogFromEnv(), existingAmazonResults, amazonArtifactPaths = defaultAmazonArtifactPaths, jsonPath = defaultReviewCandidatesJsonPath, csvPath = defaultReviewCandidatesCsvPath } = {}) {
  const { products, sources } = await loadAvailableStoreProducts(connectors);
  const reusableAmazonResults = existingAmazonResults ?? await loadExistingAmazonResults(amazonArtifactPaths);
  const candidates = products.map((product) => toReviewCandidate(product, amazonCatalog, reusableAmazonResults));
  const seenCandidateKeys = new Set(candidates.map(candidateKey));
  for (const candidate of directAnalysisCandidates(reusableAmazonResults)) {
    const key = candidateKey(candidate);
    if (!seenCandidateKeys.has(key)) {
      candidates.push(candidate);
      seenCandidateKeys.add(key);
    }
  }
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
