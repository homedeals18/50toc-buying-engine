import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const varietyPackPattern = /\b(?:variety|variety[-\s]+pack|assorted|mixed[-\s]+pack|mixed[-\s]+variety|multi[-\s]+flavo[u]?r|flavo[u]?r[-\s]+variety|assortment|sampler)\b/i;
export const coldFreshExcludedPattern = /\b(?:refrigerated|frozen|dairy|milk|cheese|yogurt|butter|eggs?|meat|beef|pork|poultry|chicken|turkey|seafood|fish|fresh\s+produce|produce)\b/i;

const rootReportPath = path.resolve(process.cwd(), '../../artifacts/shopping-list-report.json');
const defaultReferralFeeRate = Number(process.env.AMAZON_REFERRAL_FEE_RATE ?? 0.15);
const defaultFbaFee = Number(process.env.AMAZON_DEFAULT_FBA_FEE ?? 5);
const minimumProfit = Number(process.env.BUYING_ENGINE_MIN_PROFIT ?? 3);
const minimumRoi = Number(process.env.BUYING_ENGINE_MIN_ROI ?? 0);

export function businessRejectionReasons(product) {
  const combined = [product.category, product.productName, product.brand, product.packageSize].filter(Boolean).join(' ');
  const reasons = [];
  if (varietyPackPattern.test(combined)) reasons.push('Explicit variety/assorted/mixed/flavor-variety/sampler product');
  if (coldFreshExcludedPattern.test(combined)) reasons.push('Refrigerated, frozen, dairy, meat, seafood, or fresh produce product');
  return reasons;
}

export function passesBusinessFilters(product) {
  return businessRejectionReasons(product).length === 0;
}

function moneyToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function formatMoney(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : `$${value.toFixed(2)}`;
}


function parseAmazonCatalog() {
  if (!process.env.AMAZON_LOOKUP_FIXTURES_JSON) return [];
  try {
    const parsed = JSON.parse(process.env.AMAZON_LOOKUP_FIXTURES_JSON);
    return Array.isArray(parsed) ? parsed : Object.values(parsed);
  } catch {
    return [];
  }
}

export async function lookupAmazonOffer(product) {
  const catalog = parseAmazonCatalog();
  const normalizedName = String(product.productName ?? '').toLowerCase();
  const offer = catalog.find((entry) =>
    (product.upc && entry.upc && String(entry.upc) === String(product.upc)) ||
    (product.sku && entry.sku && String(entry.sku) === String(product.sku)) ||
    (entry.productName && normalizedName.includes(String(entry.productName).toLowerCase()))
  );
  const storePrice = moneyToNumber(product.currentPrice);
  const amazonSellingPrice = moneyToNumber(offer?.amazonSellingPrice ?? offer?.currentFbaPrice ?? offer?.price);
  const referralFee = moneyToNumber(offer?.referralFee) ?? (amazonSellingPrice === null ? null : amazonSellingPrice * defaultReferralFeeRate);
  const fbaFee = moneyToNumber(offer?.fbaFee) ?? (amazonSellingPrice === null ? null : defaultFbaFee);
  return {
    asin: offer?.asin ?? null,
    amazonSellingPrice,
    referralFee,
    fbaFee,
    amazonFees: referralFee === null || fbaFee === null ? null : referralFee + fbaFee,
    fbaSellerCount: offer?.fbaSellerCount ?? null,
    amazonRetailSelling: offer?.amazonRetailSelling ?? false,
    category: offer?.category ?? null,
    lookupStatus: offer ? 'matched' : 'not_matched'
  };
}

export async function evaluateProduct(product) {
  const amazon = await lookupAmazonOffer(product);
  const storePrice = moneyToNumber(product.currentPrice);
  const estimatedProfit = amazon.amazonSellingPrice === null || amazon.amazonFees === null || storePrice === null
    ? null
    : amazon.amazonSellingPrice - amazon.amazonFees - storePrice;
  const roi = estimatedProfit === null || storePrice === null || storePrice === 0 ? null : estimatedProfit / storePrice;
  const rejectionReasons = [...businessRejectionReasons(product)];
  if (amazon.lookupStatus !== 'matched') rejectionReasons.push('No Amazon offer matched for profitability evaluation');
  if (amazon.amazonSellingPrice === null) rejectionReasons.push('Amazon selling price is required');
  if (estimatedProfit !== null && estimatedProfit < minimumProfit) rejectionReasons.push(`Estimated profit is below $${minimumProfit.toFixed(2)} minimum`);
  if (roi !== null && roi < minimumRoi) rejectionReasons.push(`ROI is below ${(minimumRoi * 100).toFixed(0)}% minimum`);
  if (amazon.amazonRetailSelling) rejectionReasons.push('Amazon Retail is selling the product');
  return {
    ...product,
    amazonAsin: amazon.asin,
    amazonLookupStatus: amazon.lookupStatus,
    amazonSellingPrice: formatMoney(amazon.amazonSellingPrice),
    amazonFees: formatMoney(amazon.amazonFees),
    estimatedProfit: formatMoney(estimatedProfit),
    roi: roi === null ? null : `${(roi * 100).toFixed(2)}%`,
    buyingDecision: rejectionReasons.length === 0 ? 'Buy' : "Don't Buy",
    rejectionReasons
  };
}

export async function runBuyingPipeline(products) {
  const filtered = products.filter(passesBusinessFilters);
  return Promise.all(filtered.map(evaluateProduct));
}

export function buildShoppingListReport(products) {
  return products.map((product) => ({
    recommendedStore: product.supplier,
    product: product.productName,
    price: product.currentPrice,
    amazonSellingPrice: product.amazonSellingPrice ?? null,
    amazonFees: product.amazonFees ?? null,
    estimatedProfit: product.estimatedProfit ?? null,
    roi: product.roi ?? null,
    decision: product.buyingDecision ?? null,
    dealSource: product.dealSource,
    url: product.productUrl,
    notes: [
      product.brand && `Brand: ${product.brand}`,
      product.sku && `SKU/item: ${product.sku}`,
      product.upc && `UPC: ${product.upc}`,
      product.packageSize && `Package: ${product.packageSize}`,
      product.originalPrice && `Original: ${product.originalPrice}`,
      product.discount && `Discount: ${product.discount}`,
      product.coupon && `Coupon: ${product.coupon}`,
      product.availability && `Availability: ${product.availability}`,
      product.quantityLimit && `Limit: ${product.quantityLimit}`,
      product.amazonLookupStatus && `Amazon lookup: ${product.amazonLookupStatus}`,
      product.rejectionReasons?.length ? `Reasons: ${product.rejectionReasons.join('; ')}` : null,
      'Purchase in store by 50TOC worker'
    ].filter(Boolean).join(' | ')
  }));
}

export async function writeCombinedShoppingListReport(supplier, evaluatedProducts, supplierReportPath) {
  await mkdir(path.dirname(rootReportPath), { recursive: true });
  let existing = [];
  try { existing = JSON.parse(await readFile(rootReportPath, 'utf8')); } catch {}
  const withoutSupplier = Array.isArray(existing) ? existing.filter((item) => item.recommendedStore !== supplier) : [];
  const combined = [...withoutSupplier, ...buildShoppingListReport(evaluatedProducts)];
  await writeFile(rootReportPath, JSON.stringify(combined, null, 2));
  if (supplierReportPath) await writeFile(supplierReportPath, JSON.stringify(combined, null, 2));
  return combined;
}
