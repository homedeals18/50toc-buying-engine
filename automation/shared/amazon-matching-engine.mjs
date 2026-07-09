import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultMatchingReportPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'matching-report.json');

export const confidenceRules = Object.freeze({
  upc: 100,
  asin: 100,
  brandNamePackageSize: 95,
  brandNameCount: 90,
  brandName: 80
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

function moneyToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMoney(value) {
  const numeric = moneyToNumber(value);
  return numeric === null ? null : `$${numeric.toFixed(2)}`;
}

function tokenSet(value) {
  return new Set(normalized(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
}

function hasSharedNameTokens(storeProduct, amazonProduct) {
  const storeTokens = tokenSet(storeProduct.productName ?? storeProduct.title);
  const amazonTokens = tokenSet(amazonProduct.title ?? amazonProduct.productName);
  if (storeTokens.size === 0 || amazonTokens.size === 0) return false;
  let shared = 0;
  for (const token of storeTokens) {
    if (amazonTokens.has(token)) shared += 1;
  }
  return shared >= Math.min(2, storeTokens.size);
}

function sameCleanField(left, right) {
  return normalized(left) !== '' && normalized(left) === normalized(right);
}

function sameUpc(storeProduct, amazonProduct) {
  const storeUpc = digitsOnly(storeProduct.upc ?? storeProduct.upcCode);
  const amazonUpc = digitsOnly(amazonProduct.upc ?? amazonProduct.upcCode);
  return storeUpc !== '' && storeUpc === amazonUpc;
}

function sameAsin(storeProduct, amazonProduct) {
  return sameCleanField(storeProduct.amazonAsin ?? storeProduct.asin, amazonProduct.asin ?? amazonProduct.amazonAsin);
}

function sameBrand(storeProduct, amazonProduct) {
  return sameCleanField(storeProduct.brand, amazonProduct.brand);
}

function samePackageSize(storeProduct, amazonProduct) {
  return sameCleanField(storeProduct.packageSize, amazonProduct.packageSize ?? amazonProduct.size);
}

function countValue(product) {
  return clean(product.count ?? product.packQuantity ?? product.packQty ?? product.quantity ?? product.packageCount);
}

function sameCount(storeProduct, amazonProduct) {
  const storeCount = countValue(storeProduct) || (clean(storeProduct.packageSize).match(/\b\d+\s*(?:ct|count|pk|pack)\b/i)?.[0] ?? '');
  const amazonCount = countValue(amazonProduct) || (clean(amazonProduct.packageSize ?? amazonProduct.size).match(/\b\d+\s*(?:ct|count|pk|pack)\b/i)?.[0] ?? '');
  return normalized(storeCount) !== '' && normalized(storeCount) === normalized(amazonCount);
}

export function normalizeAmazonProduct(product) {
  return {
    ...product,
    asin: clean(product.asin ?? product.amazonAsin) || null,
    title: clean(product.title ?? product.productName) || null,
    currentSellingPrice: formatMoney(product.currentSellingPrice ?? product.amazonSellingPrice ?? product.currentFbaPrice ?? product.price)
  };
}

export function loadAmazonCatalogFromEnv() {
  if (!process.env.AMAZON_LOOKUP_FIXTURES_JSON) return [];
  const parsed = JSON.parse(process.env.AMAZON_LOOKUP_FIXTURES_JSON);
  return (Array.isArray(parsed) ? parsed : Object.values(parsed)).map(normalizeAmazonProduct);
}

export function scoreAmazonCandidate(storeProduct, amazonProduct) {
  const amazon = normalizeAmazonProduct(amazonProduct);
  if (sameUpc(storeProduct, amazon)) return { confidenceScore: confidenceRules.upc, matchReason: 'UPC match', amazon };
  if (sameAsin(storeProduct, amazon)) return { confidenceScore: confidenceRules.asin, matchReason: 'ASIN match', amazon };

  const brandMatches = sameBrand(storeProduct, amazon);
  const nameMatches = hasSharedNameTokens(storeProduct, amazon);
  if (brandMatches && nameMatches && samePackageSize(storeProduct, amazon)) {
    return { confidenceScore: confidenceRules.brandNamePackageSize, matchReason: 'Brand + Product Name + Package Size', amazon };
  }
  if (brandMatches && nameMatches && sameCount(storeProduct, amazon)) {
    return { confidenceScore: confidenceRules.brandNameCount, matchReason: 'Brand + Product Name + Count', amazon };
  }
  if (brandMatches && nameMatches) {
    return { confidenceScore: confidenceRules.brandName, matchReason: 'Brand + Product Name', amazon };
  }
  return { confidenceScore: 0, matchReason: 'No matching rule satisfied', amazon };
}

export function matchProductToAmazon(storeProduct, amazonCatalog = loadAmazonCatalogFromEnv()) {
  const candidates = amazonCatalog.map((amazonProduct) => scoreAmazonCandidate(storeProduct, amazonProduct));
  const best = candidates.sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  const isMatched = Boolean(best && best.confidenceScore >= confidenceRules.brandName);
  return {
    sourceProduct: storeProduct,
    matched: isMatched,
    needsReview: !isMatched,
    confidenceScore: best?.confidenceScore ?? 0,
    matchReason: isMatched ? best.matchReason : 'Below 80 = Needs Review',
    amazonAsin: isMatched ? best.amazon.asin : null,
    amazonTitle: isMatched ? best.amazon.title : null,
    amazonCurrentSellingPrice: isMatched ? best.amazon.currentSellingPrice : null
  };
}

export function buildAmazonMatchingReport(products, amazonCatalog = loadAmazonCatalogFromEnv()) {
  const matches = products.map((product) => matchProductToAmazon(product, amazonCatalog));
  return {
    engine: 'amazon-matching-engine-v1',
    generatedAt: new Date().toISOString(),
    totals: {
      inputProducts: products.length,
      matched: matches.filter((match) => match.matched).length,
      notMatched: matches.filter((match) => !match.matched).length,
      needsReview: matches.filter((match) => match.needsReview).length
    },
    confidenceRules: {
      '100': 'UPC match',
      '95': 'Brand + Product Name + Package Size',
      '90': 'Brand + Product Name + Count',
      '80': 'Brand + Product Name',
      'Below 80': 'Needs Review'
    },
    matches
  };
}

export async function readDealProducts(dealProductsPath) {
  const raw = await readFile(dealProductsPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('deal-products.json must contain an array');
  return parsed;
}

export async function runAmazonMatchingEngine({ dealProductsPath, amazonCatalog = loadAmazonCatalogFromEnv(), reportPath = defaultMatchingReportPath } = {}) {
  if (!dealProductsPath) throw new Error('dealProductsPath is required');
  const products = await readDealProducts(dealProductsPath);
  const report = buildAmazonMatchingReport(products, amazonCatalog);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const dealProductsPath = process.argv[2];
  const report = await runAmazonMatchingEngine({ dealProductsPath });
  console.log(`Amazon Matching Engine v1 complete: ${report.totals.matched}/${report.totals.inputProducts} matched.`);
  console.log(`Wrote ${path.relative(repositoryRoot, defaultMatchingReportPath)}`);
}
