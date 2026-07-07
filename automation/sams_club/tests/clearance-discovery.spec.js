import { chromium, test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { businessRejectionReasons, runBuyingPipeline, varietyPackPattern, writeCombinedShoppingListReport } from '../../shared/buying-engine.js';
import { samsClubConnectorConfig as config } from '../connector-config.mjs';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/sams_club');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const dealProductsPath = path.join(logDir, 'deal-products.json');
const shoppingListReportPath = path.join(logDir, 'shopping-list-report.json');

async function ensureArtifactDirs() {
  await Promise.all([mkdir(screenshotDir, { recursive: true }), mkdir(logDir, { recursive: true }), mkdir(profileDir, { recursive: true })]);
}

function samsUrl(pathname = '/') {
  return new URL(pathname, config.baseUrl).toString();
}

async function failIfBlocked(page, label = 'current page') {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (/access\s+denied|forbidden|captcha|robot|verify\s+you\s+are\s+human/i.test(`${title}\n${body}`)) {
    const screenshotPath = await saveStep(page, `blocked-${label}`);
    throw new Error(`Sam's Club blocking or access challenge detected on ${label} (${page.url()}). Screenshot saved to ${screenshotPath}.`);
  }
}

async function gotoAndCheck(page, url, options = {}, label = String(url)) {
  const response = await page.goto(samsUrl(url), options);
  await failIfBlocked(page, label);
  return response;
}

const test = base.extend({
  context: async ({}, use) => {
    await ensureArtifactDirs();
    const context = await chromium.launchPersistentContext(profileDir, {
      baseURL: config.baseUrl,
      headless: false,
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    });
    try { await use(context); } finally { await context.close(); }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? await context.newPage();
    await use(page);
  }
});

async function saveStep(page, name, details = {}) {
  await ensureArtifactDirs();
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(path.join(logDir, `${safeName}.json`), JSON.stringify({ ...details, url: page.url(), title: await page.title().catch(() => ''), savedAt: new Date().toISOString(), screenshotPath }, null, 2));
  return screenshotPath;
}

async function dismissOverlays(page) {
  for (const selector of ['button:has-text("Accept")', 'button:has-text("I Agree")', 'button:has-text("Got it")', 'button[aria-label*="close" i]', 'button:has-text("No Thanks")']) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) await button.click({ timeout: 2_000 }).catch(() => undefined);
  }
}

async function setClubLocationIfAvailable(page) {
  await dismissOverlays(page);
  const locationTrigger = page.locator('button, a').filter({ hasText: /club|location|zip|pickup|Secaucus|07094/i }).first();
  if (await locationTrigger.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await locationTrigger.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
  const zipInput = page.locator('input[placeholder*="zip" i], input[aria-label*="zip" i], input[name*="zip" i], input[id*="zip" i]').first();
  if (await zipInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await zipInput.fill(config.clubZipCode);
    await page.keyboard.press('Enter').catch(() => undefined);
    const setButton = page.locator('button').filter({ hasText: /set|save|update|make\s+this\s+my\s+club/i }).first();
    if (await setButton.isVisible({ timeout: 3_000 }).catch(() => false)) await setButton.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
  return { clubLocation: config.clubLocation, clubZipCode: config.clubZipCode, locationTextSeen: /Secaucus|07094/i.test(await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')) };
}

async function navigateToClearance(page) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, 'homepage');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const location = await setClubLocationIfAvailable(page);
  const clearanceLink = page.locator('a, button').filter({ hasText: /clearance/i }).first();
  if (await clearanceLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined), clearanceLink.click({ timeout: 10_000 })]);
  } else {
    const searchBox = page.locator('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i], form[role="search"] input').first();
    if (!(await searchBox.isVisible({ timeout: 10_000 }).catch(() => false))) throw new Error("Unable to find Sam's Club search input for Clearance.");
    await searchBox.fill(config.dealSource.searchTerm);
    await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined), searchBox.press('Enter')]);
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfBlocked(page, 'clearance');
  await saveStep(page, '01-sams-club-clearance', { location });
  return { discoveredUrl: page.url(), location };
}

async function loadMoreProductsIfAvailable(page) {
  for (let attempts = 0; attempts < 3; attempts += 1) {
    const loadMore = page.locator('button:has-text("Load More"), a:has-text("Load More"), button:has-text("Show More")').first();
    if (!(await loadMore.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await loadMore.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
}

function productTileExtractorScript({ dealSourceName, relevantSources, excludedSource, varietySource, filterAllowed = false }) {
  const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
  const absUrl = (value) => { try { return value ? new URL(value, location.href).toString() : null; } catch { return null; } };
  const relevant = relevantSources.map((source) => new RegExp(source, 'i'));
  const excluded = new RegExp(excludedSource, 'i');
  const variety = new RegExp(varietySource, 'i');
  const visible = (node) => !!(node?.offsetWidth || node?.offsetHeight || node?.getClientRects().length);
  const productHrefPattern = /(?:\/p\/|\/product\/|\/ip\/|prod\d+|productId=|itemId=)/i;
  const nonProductHrefPattern = /\/cart|\/checkout|\/account|\/orders?|\/login|\/register|\/membership|\/club|\/help|\/privacy|\/terms/i;
  const itemFromHref = (href) => clean(href?.match(/(?:prod|itemId=|productId=)(\d+)/i)?.[1]);
  const findCard = (link) => link.closest('li, article, [data-testid*="product" i], [class*="product" i], [class*="item" i], div') || link;
  const links = [...document.querySelectorAll('a[href]')].filter((link) => visible(link) && productHrefPattern.test(link.getAttribute('href') || '') && !nonProductHrefPattern.test(link.getAttribute('href') || ''));
  const seen = new Set();
  return links.map((link) => {
    const productUrl = absUrl(link.getAttribute('href'));
    if (!productUrl || seen.has(productUrl)) return null;
    const card = findCard(link);
    const text = clean(card.textContent) || '';
    const image = card.querySelector('img[alt], img') || link.querySelector('img[alt], img');
    const productName = clean(link.getAttribute('aria-label') || link.getAttribute('title') || link.querySelector('img')?.getAttribute('alt') || card.querySelector('[data-testid*="name" i], [class*="name" i], h2, h3, h4')?.textContent || link.textContent || image?.getAttribute('alt'));
    const category = clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent || card.closest('[data-category]')?.getAttribute('data-category'));
    const combined = [category, productName, text].filter(Boolean).join(' ');
    if (filterAllowed && (variety.test(combined) || excluded.test(combined))) return null;
    if (filterAllowed && category && !relevant.some((pattern) => pattern.test(category))) return null;
    seen.add(productUrl);
    const prices = text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g) || [];
    return { supplier: "Sam's Club", dealSource: dealSourceName, category, productName, brand: null, sku: clean(text.match(/(?:Item|SKU|Model)\s*#?\s*:?\s*([A-Z0-9-]{3,})/i)?.[1]) || itemFromHref(productUrl), upc: null, packageSize: clean(text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]), currentPrice: prices[0] ?? null, originalPrice: prices[1] ?? null, discount: clean(text.match(/(?:save|clearance|instant savings)[^$%]{0,40}(?:\$\s*\d+(?:\.\d{2})?|\d+\s*%)/i)?.[0]), coupon: null, availability: clean(text.match(/(?:in stock|out of stock|available|pickup|shipping)[^.]{0,80}/i)?.[0]), quantityLimit: clean(text.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]), productUrl, imageUrl: absUrl(image?.currentSrc || image?.getAttribute('src')), scanDate: new Date().toISOString() };
  }).filter(Boolean);
}

function productRejectionReasons(product) {
  const reasons = [];
  const combined = [product.category, product.productName, product.brand].filter(Boolean).join(' ');
  for (const [field, label] of [['productName', 'product name'], ['currentPrice', 'current price'], ['productUrl', 'product URL']]) {
    if (!product[field] || String(product[field]).trim().length === 0) reasons.push(`Missing required field: ${label}`);
  }
  reasons.push(...businessRejectionReasons(product));
  if (config.excludedCategoryPattern.test(combined)) reasons.push("Excluded Sam's Club category or department");
  if (product.category && !config.relevantCategoryPatterns.some((pattern) => pattern.test(product.category))) reasons.push("Category is not in the allowed Sam's Club departments");
  return reasons;
}

function unifiedDeal(product) {
  return { supplier: product.supplier ?? config.supplier, dealSource: product.dealSource ?? config.dealSource.name, category: product.category ?? null, productName: product.productName ?? null, brand: product.brand ?? null, sku: product.sku ?? null, upc: product.upc ?? null, packageSize: product.packageSize ?? null, currentPrice: product.currentPrice ?? null, originalPrice: product.originalPrice ?? null, discount: product.discount ?? null, coupon: product.coupon ?? null, availability: product.availability ?? null, quantityLimit: product.quantityLimit ?? null, productUrl: product.productUrl ?? null, imageUrl: product.imageUrl ?? null, scanDate: product.scanDate ?? new Date().toISOString() };
}

async function extractListingProducts(page) {
  await loadMoreProductsIfAvailable(page);
  for (let i = 0; i < 2; i += 1) { await page.mouse.wheel(0, 1800).catch(() => undefined); await page.waitForTimeout(750); }
  return page.evaluate(productTileExtractorScript, { dealSourceName: config.dealSource.name, relevantSources: config.relevantCategoryPatterns.map((p) => p.source), excludedSource: config.excludedCategoryPattern.source, varietySource: varietyPackPattern.source, filterAllowed: false });
}

async function enrichProductFromPage(page, listingProduct, index) {
  await gotoAndCheck(page, listingProduct.productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }, `product-${index + 1}`);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await saveStep(page, `02-clearance-product-${String(index + 1).padStart(2, '0')}`);
  const details = await page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const absUrl = (value) => { try { return value ? new URL(value, location.href).toString() : null; } catch { return null; } };
    const bodyText = clean(document.body.innerText) || '';
    const image = document.querySelector('img[alt], img');
    const jsonProducts = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => { try { return [JSON.parse(node.textContent || 'null')].flat(Infinity); } catch { return []; } }).filter((entry) => /Product/i.test(String(entry?.['@type'] ?? '')));
    const productJson = jsonProducts[0] ?? {};
    const offer = Array.isArray(productJson.offers) ? productJson.offers[0] : productJson.offers;
    const prices = bodyText.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g) || [];
    return { productName: clean(productJson.name) || clean(document.querySelector('h1, [data-testid*="product-name" i]')?.textContent), brand: clean(typeof productJson.brand === 'string' ? productJson.brand : productJson.brand?.name), sku: clean(productJson.sku) || clean(bodyText.match(/(?:Item|Item #|SKU|Model)\s*#?\s*:?\s*([A-Z0-9-]{3,})/i)?.[1]), upc: clean(productJson.gtin12 || productJson.gtin13 || productJson.gtin14 || productJson.gtin), category: clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent), packageSize: clean(bodyText.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]), currentPrice: offer?.price ? `$${Number(offer.price).toFixed(2)}` : prices[0] ?? null, originalPrice: prices[1] ?? null, discount: clean(bodyText.match(/(?:save|clearance|instant savings)[^$%]{0,40}(?:\$\s*\d+(?:\.\d{2})?|\d+\s*%)/i)?.[0]), availability: clean(offer?.availability) || clean(bodyText.match(/(?:in stock|out of stock|available|pickup|shipping)[^.]{0,100}/i)?.[0]), quantityLimit: clean(bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]), productUrl: location.href, imageUrl: absUrl(Array.isArray(productJson.image) ? productJson.image[0] : productJson.image) || absUrl(image?.currentSrc || image?.getAttribute('src')), scanDate: new Date().toISOString() };
  });
  return unifiedDeal({ ...listingProduct, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value)) });
}

async function saveProgress(products) {
  const evaluatedProducts = await runBuyingPipeline(products.map(unifiedDeal).filter((product) => productRejectionReasons(product).length === 0));
  await writeFile(dealProductsPath, JSON.stringify(evaluatedProducts, null, 2));
  await writeCombinedShoppingListReport(config.supplier, evaluatedProducts, shoppingListReportPath);
  return evaluatedProducts;
}

test.describe("Sam's Club clearance shopping list intelligence", () => {
  test('scrapes Clearance only, without login, cart, checkout, or purchase actions', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
    const { discoveredUrl, location } = await navigateToClearance(page);
    const listingScreenshots = [];
    for (let i = 0; i < config.maxListingScreenshots; i += 1) { listingScreenshots.push(await saveStep(page, `01-clearance-listing-page-${i + 1}`)); await page.mouse.wheel(0, 1400).catch(() => undefined); await page.waitForTimeout(750); }
    const listingProducts = await extractListingProducts(page);
    if (listingProducts.length === 0) throw new Error("Sam's Club Clearance had no detected visible product tiles.");
    const products = [];
    const rejectedProducts = [];
    for (const [index, product] of listingProducts.slice(0, config.maxProducts).entries()) {
      const enrichedProduct = await enrichProductFromPage(page, product, index);
      const rejectionReasons = productRejectionReasons(enrichedProduct);
      if (rejectionReasons.length === 0) { products.push(enrichedProduct); await saveProgress(products); }
      else rejectedProducts.push({ product: enrichedProduct, reasons: rejectionReasons });
    }
    const evaluatedProducts = await saveProgress(products);
    await writeFile(path.join(logDir, 'deal-execution-report.json'), JSON.stringify({ connector: config.supplier, sourceReports: [{ dealSource: config.dealSource.name, discoveredUrl, productCount: products.length, scrapedProductLimit: config.maxProducts, skippedByLimitCount: Math.max(listingProducts.length - config.maxProducts, 0), listingScreenshots }], productCount: products.length, rejectedProducts: rejectedProducts.map(({ product, reasons }) => ({ productName: product.productName, sku: product.sku, productUrl: product.productUrl, rejectionReasons: reasons })), outputs: { dealProducts: dealProductsPath, shoppingListReport: shoppingListReportPath }, businessRules: { global50TocRules: true, clearanceOnly: true, regularCatalogPagesScraped: false, clubLocation: config.clubLocation, location, didLogin: false, usedPassword: false, usedMembershipAuthentication: false, didAddToCart: false, didCheckout: false, didPurchase: false, maxProductsConfig: 'SAMS_CLUB_MAX_CLEARANCE_PRODUCTS' }, categories: { allowed: config.relevantCategoryPatterns.map((pattern) => pattern.source), excluded: config.excludedCategoryPattern.source }, evaluatedProductCount: evaluatedProducts.length, screenshotsDirectory: screenshotDir, logsDirectory: logDir, consoleMessages, completedAt: new Date().toISOString() }, null, 2));
  });
});
