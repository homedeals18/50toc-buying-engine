import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultMatchingReportPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'matching-report.json');

export const confidenceRules = Object.freeze({
  upc: 100,
  asin: 98,
  brandPackageCountPackageSizeFlavorName: 96,
  brandPackageCountPackageSizeName: 92,
  brandPackageCountPackageSize: 88,
  brandPackageCount: 84,
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

const varietyPackPattern = /\b(?:variety|assorted|assortment|mixed|multi[-\s]*flavo[u]?r|flavo[u]?r\s*variety|sampler)\b/i;
const singleItemPattern = /\b(?:single|each|individual|1\s*(?:ct|count|pk|pack))\b/i;
const multiPackPattern = /\b(?:multi[-\s]*pack|\d+\s*(?:ct|count|pk|pack)|pack\s*of\s*\d+)\b/i;
const flavorWords = [
  'apple', 'banana', 'berry', 'blueberry', 'caramel', 'cheddar', 'cherry', 'chocolate', 'cinnamon',
  'classic', 'coconut', 'cola', 'cranberry', 'grape', 'honey', 'lemon', 'lime', 'mango', 'mint',
  'orange', 'original', 'peach', 'peanut butter', 'raspberry', 'salted', 'strawberry', 'vanilla', 'watermelon'
];

function combinedText(product) {
  return [product.productName, product.title, product.flavor, product.variant, product.packageSize, product.size, product.count, product.packageCount].filter(Boolean).join(' ');
}

function isVarietyPack(product) {
  return varietyPackPattern.test(combinedText(product));
}

function packCount(product) {
  const explicit = product.packageCount ?? product.packCount ?? product.count ?? product.packQuantity ?? product.packQty ?? product.quantity;
  const text = [explicit, product.packageSize, product.size, product.productName, product.title].filter(Boolean).join(' ');
  const match = text.match(/\b(?:pack\s*of\s*)?(\d+)\s*(?:ct|count|pk|pack)s?\b/i);
  if (match) return Number(match[1]);
  if (singleItemPattern.test(text)) return 1;
  return null;
}

function packageSizeValue(product) {
  const text = [product.packageSize, product.size, product.unitSize, product.productName, product.title].filter(Boolean).join(' ');
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(fl\s*oz|fluid\s*ounces?|oz|ounces?|lb|lbs|pounds?|g|grams?|kg|ml|l|liters?)\b/i);
  if (!match) return null;
  const unit = match[2].toLowerCase().replace(/\s+/g, ' ');
  const canonicalUnit = unit.startsWith('fl') || unit.startsWith('fluid') ? 'fl oz'
    : unit.startsWith('ounce') || unit === 'oz' ? 'oz'
    : unit.startsWith('pound') || unit === 'lb' || unit === 'lbs' ? 'lb'
    : unit.startsWith('gram') || unit === 'g' ? 'g'
    : unit === 'kg' ? 'kg'
    : unit === 'ml' ? 'ml'
    : 'l';
  return `${Number(match[1])} ${canonicalUnit}`;
}

function flavorValue(product) {
  const explicit = normalized(product.flavor ?? product.variant);
  if (explicit) return explicit;
  if (isVarietyPack(product)) return 'variety pack';
  const text = normalized([product.productName, product.title].filter(Boolean).join(' '));
  return flavorWords.find((flavor) => text.includes(flavor)) ?? null;
}

function hasDifferentVerifiedValues(leftValue, rightValue) {
  return leftValue !== null && rightValue !== null && leftValue !== rightValue;
}

function packageValidation(storeProduct, amazonProduct) {
  const storePackCount = packCount(storeProduct);
  const amazonPackCount = packCount(amazonProduct);
  if (storePackCount === null || amazonPackCount === null) return { status: 'needs_review', reason: 'Pack count cannot be verified.' };
  if (storePackCount !== amazonPackCount) return { status: 'reject', reason: `Pack count is different (${storePackCount} vs ${amazonPackCount}).` };

  const sourceMultiPack = storePackCount > 1 || multiPackPattern.test(combinedText(storeProduct));
  const amazonMultiPack = amazonPackCount > 1 || multiPackPattern.test(combinedText(amazonProduct));
  if (sourceMultiPack !== amazonMultiPack) return { status: 'reject', reason: 'Multi-pack vs single item mismatch.' };

  const storePackageSize = packageSizeValue(storeProduct);
  const amazonPackageSize = packageSizeValue(amazonProduct);
  if (hasDifferentVerifiedValues(storePackageSize, amazonPackageSize)) return { status: 'reject', reason: `Package size is different (${storePackageSize} vs ${amazonPackageSize}).` };

  const storeIsVariety = isVarietyPack(storeProduct);
  const amazonIsVariety = isVarietyPack(amazonProduct);
  if (storeIsVariety && !amazonIsVariety) return { status: 'reject', reason: 'Variety pack must never match a fixed flavor product.' };
  if (!storeIsVariety && amazonIsVariety) return { status: 'reject', reason: 'Fixed flavor must never match a variety pack.' };

  const storeFlavor = flavorValue(storeProduct);
  const amazonFlavor = flavorValue(amazonProduct);
  if (!storeIsVariety && storeFlavor && amazonFlavor && storeFlavor !== amazonFlavor) return { status: 'reject', reason: `Flavor pack does not match (${storeFlavor} vs ${amazonFlavor}).` };

  return { status: 'pass', reason: null };
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
  const validation = packageValidation(storeProduct, amazon);
  if (validation.status !== 'pass') {
    return { confidenceScore: 0, matchReason: validation.status === 'needs_review' ? 'Needs Review' : 'Rejected', rejectionReason: validation.reason, needsReview: validation.status === 'needs_review', amazon };
  }

  const brandMatches = sameBrand(storeProduct, amazon);
  const nameMatches = hasSharedNameTokens(storeProduct, amazon);
  const packageSizeMatches = packageSizeValue(storeProduct) !== null && packageSizeValue(storeProduct) === packageSizeValue(amazon);
  const countMatches = packCount(storeProduct) !== null && packCount(storeProduct) === packCount(amazon);
  const flavorMatches = flavorValue(storeProduct) !== null && flavorValue(storeProduct) === flavorValue(amazon);

  if (sameUpc(storeProduct, amazon)) return { confidenceScore: confidenceRules.upc, matchReason: 'UPC match + verified package count, size, and flavor gates', rejectionReason: null, amazon };
  if (sameAsin(storeProduct, amazon)) return { confidenceScore: confidenceRules.asin, matchReason: 'ASIN match + verified package count, size, and flavor gates', rejectionReason: null, amazon };
  if (brandMatches && countMatches && packageSizeMatches && flavorMatches && nameMatches) return { confidenceScore: confidenceRules.brandPackageCountPackageSizeFlavorName, matchReason: 'Brand + Package Count + Package Size + Flavor + Product Name', rejectionReason: null, amazon };
  if (brandMatches && countMatches && packageSizeMatches && nameMatches) return { confidenceScore: confidenceRules.brandPackageCountPackageSizeName, matchReason: 'Brand + Package Count + Package Size + Product Name', rejectionReason: null, amazon };
  if (brandMatches && countMatches && packageSizeMatches) return { confidenceScore: confidenceRules.brandPackageCountPackageSize, matchReason: 'Brand + Package Count + Package Size', rejectionReason: null, amazon };
  if (brandMatches && countMatches) return { confidenceScore: confidenceRules.brandPackageCount, matchReason: 'Brand + Package Count', rejectionReason: null, amazon };
  if (brandMatches && nameMatches) return { confidenceScore: confidenceRules.brandName, matchReason: 'Brand + Product Name', rejectionReason: null, amazon };
  return { confidenceScore: 0, matchReason: 'No matching rule satisfied', rejectionReason: 'No matching rule satisfied.', amazon };
}

export function matchProductToAmazon(storeProduct, amazonCatalog = loadAmazonCatalogFromEnv()) {
  const candidates = amazonCatalog.map((amazonProduct) => scoreAmazonCandidate(storeProduct, amazonProduct));
  const best = candidates.sort((a, b) => b.confidenceScore - a.confidenceScore)[0];
  const isMatched = Boolean(best && best.confidenceScore >= confidenceRules.brandName && !best.needsReview && !best.rejectionReason);
  const needsReview = Boolean(best?.needsReview) || !isMatched;
  return {
    sourceProduct: storeProduct,
    status: isMatched ? 'Matched' : 'Needs Review',
    matched: isMatched,
    needsReview,
    confidenceScore: best?.confidenceScore ?? 0,
    matchReason: isMatched ? best.matchReason : 'Below 80 = Needs Review',
    rejectionReason: best?.rejectionReason ?? (isMatched ? null : 'Below 80 confidence.'),
    amazonAsin: isMatched ? best.amazon.asin : null,
    amazonTitle: isMatched ? best.amazon.title : null,
    amazonCurrentSellingPrice: isMatched ? best.amazon.currentSellingPrice : null
  };
}

export function buildAmazonMatchingReport(products, amazonCatalog = loadAmazonCatalogFromEnv()) {
  const matches = products.map((product) => matchProductToAmazon(product, amazonCatalog));
  return {
    engine: 'amazon-matching-engine-v2',
    generatedAt: new Date().toISOString(),
    totals: {
      inputProducts: products.length,
      matched: matches.filter((match) => match.matched).length,
      notMatched: matches.filter((match) => !match.matched).length,
      needsReview: matches.filter((match) => match.needsReview).length
    },
    confidenceRules: {
      '100': 'UPC match after package count, package size, multi-pack, and flavor gates',
      '98': 'ASIN match after package count, package size, multi-pack, and flavor gates',
      '96': 'Brand + Package Count + Package Size + Flavor + Product Name',
      '92': 'Brand + Package Count + Package Size + Product Name',
      '88': 'Brand + Package Count + Package Size',
      '84': 'Brand + Package Count',
      '80': 'Brand + Product Name after required gates',
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
  console.log(`Amazon Matching Engine v2 complete: ${report.totals.matched}/${report.totals.inputProducts} matched.`);
  console.log(`Wrote ${path.relative(repositoryRoot, defaultMatchingReportPath)}`);
}
