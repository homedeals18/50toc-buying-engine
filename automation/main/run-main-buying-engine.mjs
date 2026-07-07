import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function resolveProjectPath(...segments) {
  return path.resolve(repositoryRoot, ...segments);
}

export function resolveArtifactPath(...segments) {
  return resolveProjectPath('artifacts', ...segments);
}

export function toProjectRelativePath(absolutePath) {
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return absolutePath;
  }
  return relativePath.split(path.sep).join(path.posix.sep);
}

const mainArtifactRoot = resolveArtifactPath('main');
const finalShoppingListPath = resolveArtifactPath('main', 'final-shopping-list.json');
const finalExecutionReportPath = resolveArtifactPath('main', 'final-execution-report.json');

export const defaultConnectorRegistry = [
  {
    id: 'bjs',
    name: "BJ's Wholesale Club",
    enabled: true,
    dealProductsPath: resolveArtifactPath('bjs', 'logs', 'deal-products.json')
  },
  {
    id: 'costco_business_center',
    name: 'Costco Business Center',
    enabled: true,
    dealProductsPath: resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json')
  },
  {
    id: 'sams_club',
    name: "Sam's Club",
    enabled: false,
    dealProductsPath: resolveArtifactPath('sams_club', 'logs', 'deal-products.json')
  }
];

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

function productIdentity(product) {
  const upc = clean(product.upc);
  if (upc) return { key: `upc:${upc}`, strategy: 'UPC', value: upc };

  const brand = normalized(product.brand);
  const productName = normalized(product.productName);
  const packageSize = normalized(product.packageSize);
  const fallback = [brand, productName, packageSize].join('|');
  return { key: `brand-name-size:${fallback}`, strategy: 'Brand + Product Name + Package Size', value: fallback };
}

function toOffer(product, connector) {
  const purchasePrice = moneyToNumber(product.currentPrice ?? product.price);
  return {
    storeId: connector.id,
    storeName: product.supplier ?? connector.name,
    purchasePrice,
    purchasePriceDisplay: product.currentPrice ?? product.price ?? null,
    originalPrice: product.originalPrice ?? null,
    discount: product.discount ?? null,
    coupon: product.coupon ?? null,
    dealSource: product.dealSource ?? null,
    availability: product.availability ?? null,
    quantityLimit: product.quantityLimit ?? null,
    productUrl: product.productUrl ?? null,
    sku: product.sku ?? null,
    buyingDecision: product.buyingDecision ?? null,
    amazonAsin: product.amazonAsin ?? null,
    amazonSellingPrice: product.amazonSellingPrice ?? null,
    amazonFees: product.amazonFees ?? null,
    estimatedProfit: product.estimatedProfit ?? null,
    roi: product.roi ?? null,
    rejectionReasons: product.rejectionReasons ?? []
  };
}

function resolveDealProductsPath(relativePath) {
  const repoRoot = process.cwd();
  const resolvedDealProductsPath = path.resolve(repoRoot, relativePath);
  return {
    repoRoot,
    resolvedDealProductsPath,
    exists: existsSync(resolvedDealProductsPath)
  };
}

async function loadConnectorProducts(connector) {
  const pathDebug = resolveDealProductsPath(connector.dealProductsPath);
  if (!pathDebug.exists) {
    const missingError = new Error(`Missing ${connector.name} deal-products.json at ${toProjectRelativePath(pathDebug.resolvedDealProductsPath)}`);
    missingError.code = 'MISSING_DEAL_PRODUCTS';
    missingError.isWarning = true;
    missingError.pathDebug = pathDebug;
    throw missingError;
  }

  const raw = await readFile(pathDebug.resolvedDealProductsPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${connector.name} deal-products.json must contain an array`);
  return {
    products: parsed.map((product) => ({ ...product, supplier: product.supplier ?? connector.name })),
    pathDebug
  };
}

export async function loadEnabledConnectorProducts(connectors = defaultConnectorRegistry) {
  const connectorReports = [];
  const loaded = [];

  for (const connector of connectors.filter((entry) => entry.enabled !== false)) {
    try {
      const { products, pathDebug } = await loadConnectorProducts(connector);
      loaded.push(...products.map((product) => ({ product, connector })));
      connectorReports.push({
        connectorId: connector.id,
        connectorName: connector.name,
        status: 'loaded',
        severity: 'info',
        dealProductsPath: toProjectRelativePath(pathDebug.resolvedDealProductsPath),
        repoRoot: pathDebug.repoRoot,
        resolvedDealProductsPath: pathDebug.resolvedDealProductsPath,
        exists: pathDebug.exists,
        productCount: products.length,
        message: `Loaded ${products.length} products from ${connector.name}`
      });
    } catch (error) {
      const isMissingDealProducts = error.code === 'MISSING_DEAL_PRODUCTS';
      const pathDebug = error.pathDebug ?? resolveDealProductsPath(connector.dealProductsPath);
      connectorReports.push({
        connectorId: connector.id,
        connectorName: connector.name,
        status: isMissingDealProducts ? 'missing' : 'failed',
        severity: isMissingDealProducts ? 'warning' : 'error',
        dealProductsPath: toProjectRelativePath(pathDebug.resolvedDealProductsPath),
        repoRoot: pathDebug.repoRoot,
        resolvedDealProductsPath: pathDebug.resolvedDealProductsPath,
        exists: pathDebug.exists,
        productCount: 0,
        warning: isMissingDealProducts ? error.message : undefined,
        error: isMissingDealProducts ? undefined : error.message,
        message: isMissingDealProducts
          ? `Warning: ${error.message}`
          : `Failed to load ${connector.name}: ${error.message}`
      });
    }
  }

  return { loaded, connectorReports };
}

export function mergeProducts(loadedProducts) {
  const byIdentity = new Map();

  for (const { product, connector } of loadedProducts) {
    const identity = productIdentity(product);
    if (!byIdentity.has(identity.key)) {
      byIdentity.set(identity.key, {
        identity,
        upc: clean(product.upc) || null,
        brand: product.brand ?? null,
        productName: product.productName ?? null,
        packageSize: product.packageSize ?? null,
        category: product.category ?? null,
        offers: []
      });
    }

    const merged = byIdentity.get(identity.key);
    merged.offers.push(toOffer(product, connector));
  }

  return [...byIdentity.values()].map((product) => {
    const pricedOffers = product.offers.filter((offer) => offer.purchasePrice !== null);
    const lowestPurchasePrice = pricedOffers.length ? Math.min(...pricedOffers.map((offer) => offer.purchasePrice)) : null;
    const lowestOffers = lowestPurchasePrice === null ? [] : product.offers.filter((offer) => offer.purchasePrice === lowestPurchasePrice);
    return {
      ...product,
      offerCount: product.offers.length,
      storeCount: new Set(product.offers.map((offer) => offer.storeId)).size,
      lowestPurchasePrice,
      lowestPurchasePriceDisplay: lowestPurchasePrice === null ? null : `$${lowestPurchasePrice.toFixed(2)}`,
      lowestPurchaseStores: lowestOffers.map((offer) => offer.storeName),
      offers: product.offers.map((offer) => ({ ...offer, isLowestPurchasePrice: lowestPurchasePrice !== null && offer.purchasePrice === lowestPurchasePrice }))
    };
  });
}

export function buildExecutionReport({ connectorReports, finalProducts }) {
  const totalLoadedProducts = connectorReports.reduce((sum, connector) => sum + connector.productCount, 0);
  return {
    pipeline: 'main-buying-engine',
    completedAt: new Date().toISOString(),
    connectors: connectorReports,
    totals: {
      loadedProducts: totalLoadedProducts,
      uniqueProducts: finalProducts.length,
      duplicateOffersMerged: Math.max(totalLoadedProducts - finalProducts.length, 0),
      productsWithMultipleOffers: finalProducts.filter((product) => product.offerCount > 1).length,
      productsWithLowestPurchasePrice: finalProducts.filter((product) => product.lowestPurchasePrice !== null).length
    },
    deduplication: {
      primary: 'UPC',
      fallback: 'Brand + Product Name + Package Size',
      keepsEveryStoreOffer: true,
      marksLowestPurchasePrice: true
    },
    outputs: {
      finalShoppingList: toProjectRelativePath(finalShoppingListPath),
      finalExecutionReport: toProjectRelativePath(finalExecutionReportPath)
    }
  };
}

export async function runMainBuyingEngine(connectors = defaultConnectorRegistry) {
  await mkdir(mainArtifactRoot, { recursive: true });
  const { loaded, connectorReports } = await loadEnabledConnectorProducts(connectors);
  for (const connectorReport of connectorReports) {
    const logger = connectorReport.severity === 'warning' ? console.warn : connectorReport.severity === 'error' ? console.error : console.log;
    logger(`[Main Buying Engine] ${connectorReport.message}`);
  }
  const finalProducts = mergeProducts(loaded);
  const report = buildExecutionReport({ connectorReports, finalProducts });
  await writeFile(finalShoppingListPath, JSON.stringify(finalProducts, null, 2));
  await writeFile(finalExecutionReportPath, JSON.stringify(report, null, 2));
  return { finalProducts, report };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { finalProducts, report } = await runMainBuyingEngine();
  console.log(`Main Buying Engine complete: ${finalProducts.length} unique products from ${report.totals.loadedProducts} loaded offers.`);
  console.log(`Wrote ${toProjectRelativePath(finalShoppingListPath)}`);
  console.log(`Wrote ${toProjectRelativePath(finalExecutionReportPath)}`);
}
