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

async function clickAndCheck(page, locator, label) {
  await failIfBlocked(page, `${label}-before-click`);
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined),
    locator.click({ timeout: 10_000 })
  ]);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfBlocked(page, label);
}

async function findVisibleNavigationLink(page, pattern, timeout = 3_000) {
  const link = page.locator('a, button, [role="menuitem"], [role="link"], [role="button"]').filter({ hasText: pattern }).first();
  return (await link.isVisible({ timeout }).catch(() => false)) ? link : null;
}

async function openSavingsNavigation(page) {
  const directSavingsLink = await findVisibleNavigationLink(page, /\b(Savings|Deals|Offers)\b/i, 8_000);
  if (directSavingsLink) {
    await clickAndCheck(page, directSavingsLink, 'savings-link');
    return 'direct-savings-link';
  }

  const menuTriggers = [
    /All\s+(Departments|Categories)/i,
    /Departments|Categories|Shop/i,
    /Menu/i
  ];
  for (const pattern of menuTriggers) {
    const trigger = await findVisibleNavigationLink(page, pattern, 3_000);
    if (!trigger) continue;
    await trigger.click({ timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
    await failIfBlocked(page, 'navigation-menu');
    const nestedSavingsLink = await findVisibleNavigationLink(page, /\b(Savings|Deals|Offers)\b/i, 3_000);
    if (nestedSavingsLink) {
      await clickAndCheck(page, nestedSavingsLink, 'savings-menu-link');
      return 'nested-savings-menu-link';
    }
  }

  throw new Error("Unable to locate Sam's Club Savings through live homepage navigation without using search.");
}

async function navigateFromSavingsToClearance(page) {
  const clearancePatterns = [/\bClearance\b/i, /\bLast\s+Chance\b/i, /\bCloseout/i];
  for (const pattern of clearancePatterns) {
    const clearanceLink = await findVisibleNavigationLink(page, pattern, 5_000);
    if (clearanceLink) {
      await clickAndCheck(page, clearanceLink, 'clearance-link');
      return { dealSourceName: config.dealSource.name, clearanceFound: true };
    }
  }

  const filters = page.locator('label, button, a').filter({ hasText: /\bClearance\b/i }).first();
  if (await filters.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await clickAndCheck(page, filters, 'clearance-filter');
    return { dealSourceName: config.dealSource.name, clearanceFound: true };
  }

  return { dealSourceName: config.fallbackDealSource.name, clearanceFound: false };
}

async function navigateToClearance(page) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, 'homepage');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const location = await setClubLocationIfAvailable(page);
  const savingsNavigationMethod = await openSavingsNavigation(page);
  const savingsUrl = page.url();
  await saveStep(page, '01-sams-club-savings', { location, savingsNavigationMethod });
  const source = await navigateFromSavingsToClearance(page);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfBlocked(page, source.clearanceFound ? 'clearance' : 'savings');
  await saveStep(page, source.clearanceFound ? '02-sams-club-clearance' : '02-sams-club-savings-fallback', { location, savingsNavigationMethod, savingsUrl, ...source });
  if (/\/search\?q=clearance/i.test(page.url())) throw new Error(`Sam's Club connector reached forbidden clearance search URL: ${page.url()}`);
  return { discoveredUrl: page.url(), savingsUrl, location, ...source };
}

async function loadMoreProductsIfAvailable(page) {
  for (let attempts = 0; attempts < 3; attempts += 1) {
    const loadMore = page.locator('button:has-text("Load More"), a:has-text("Load More"), button:has-text("Show More")').first();
    if (!(await loadMore.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await loadMore.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
}

function productTileExtractorScript({ dealSourceName, relevantSources, excludedSource, varietySource, filterAllowed = false, maxProducts = 10 }) {
  const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
  const absUrl = (value) => { try { return value ? new URL(value, location.href).toString() : null; } catch { return null; } };
  const relevant = relevantSources.map((source) => new RegExp(source, 'i'));
  const excluded = new RegExp(excludedSource, 'i');
  const variety = new RegExp(varietySource, 'i');
  const visible = (node) => {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const productHrefPattern = /(?:\/p\/|\/ip\/)/i;
  const fallbackHrefPattern = /(?:\/product\/|prod\d+|productId=|itemId=)/i;
  const nonProductHrefPattern = /\/cart|\/checkout|\/account|\/orders?|\/login|\/register|\/membership|\/club|\/help|\/privacy|\/terms/i;
  const cardSelector = [
    '[data-testid*="product" i]',
    '[data-automation-id*="product" i]',
    '[data-component*="product" i]',
    '[class*="product-card" i]',
    '[class*="ProductCard" i]',
    '[class*="search-result" i]',
    '[class*="tile" i]',
    'article',
    'li'
  ].join(', ');
  const itemFromHref = (href) => clean(href?.match(/(?:prod|itemId=|productId=|\/p\/[^/]+\/)(\d+)/i)?.[1]);
  const findCard = (link) => {
    const semanticCard = link.closest(cardSelector);
    if (semanticCard && visible(semanticCard)) return semanticCard;
    let node = link.parentElement;
    while (node && node !== document.body) {
      const text = clean(node.textContent) || '';
      const hasPrice = /\$\s*\d/.test(text);
      const hasImage = !!node.querySelector('img');
      const productLinks = [...node.querySelectorAll('a[href]')].filter((candidate) => productHrefPattern.test(candidate.getAttribute('href') || '') || fallbackHrefPattern.test(candidate.getAttribute('href') || ''));
      if (visible(node) && hasImage && hasPrice && productLinks.length <= 4) return node;
      node = node.parentElement;
    }
    return link;
  };
  const linkCandidates = [...document.querySelectorAll('a[href]')]
    .filter((link) => visible(link))
    .map((link) => ({ link, href: link.getAttribute('href') || '' }))
    .filter(({ href }) => !nonProductHrefPattern.test(href) && (productHrefPattern.test(href) || fallbackHrefPattern.test(href)))
    .sort((a, b) => Number(productHrefPattern.test(b.href)) - Number(productHrefPattern.test(a.href)));
  const seen = new Set();
  const products = [];
  for (const { link, href } of linkCandidates) {
    const productUrl = absUrl(href);
    if (!productUrl || seen.has(productUrl)) continue;
    const card = findCard(link);
    if (!visible(card)) continue;
    const text = clean(card.textContent) || '';
    const image = card.querySelector('img[alt], img') || link.querySelector('img[alt], img');
    const productName = clean(link.getAttribute('aria-label') || link.getAttribute('title') || link.querySelector('img')?.getAttribute('alt') || card.querySelector('[data-testid*="name" i], [data-automation-id*="name" i], [class*="name" i], [class*="title" i], h2, h3, h4')?.textContent || link.textContent || image?.getAttribute('alt'));
    const category = clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent || card.closest('[data-category]')?.getAttribute('data-category'));
    const combined = [category, productName, text].filter(Boolean).join(' ');
    if (filterAllowed && (variety.test(combined) || excluded.test(combined))) continue;
    if (filterAllowed && category && !relevant.some((pattern) => pattern.test(category))) continue;
    seen.add(productUrl);
    const prices = text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g) || [];
    products.push({ supplier: "Sam's Club", dealSource: dealSourceName, category, productName, brand: null, sku: clean(text.match(/(?:Item|SKU|Model)\s*#?\s*:?\s*([A-Z0-9-]{3,})/i)?.[1]) || itemFromHref(productUrl), upc: null, packageSize: clean(text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]), currentPrice: prices[0] ?? null, originalPrice: prices[1] ?? null, discount: clean(text.match(/(?:save|clearance|instant savings)[^$%]{0,40}(?:\$\s*\d+(?:\.\d{2})?|\d+\s*%)/i)?.[0]), coupon: null, availability: clean(text.match(/(?:in stock|out of stock|available|pickup|shipping)[^.]{0,80}/i)?.[0]), quantityLimit: clean(text.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]), productUrl, imageUrl: absUrl(image?.currentSrc || image?.getAttribute('src')), listingText: text.slice(0, 500), scanDate: new Date().toISOString() });
    if (products.length >= maxProducts) break;
  }
  return products;
}

async function saveZeroProductDebug(page, name = 'sams-club-clearance-zero-products') {
  await ensureArtifactDirs();
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
  const htmlPath = path.join(logDir, `${safeName}.html`);
  const jsonPath = path.join(logDir, `${safeName}.json`);
  const debug = await page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || '';
    const visible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const productHrefPattern = /(?:\/p\/|\/ip\/)/i;
    const fallbackHrefPattern = /(?:\/product\/|prod\d+|productId=|itemId=)/i;
    const productLinks = [...document.querySelectorAll('a[href]')]
      .filter((link) => visible(link) && (productHrefPattern.test(link.getAttribute('href') || '') || fallbackHrefPattern.test(link.getAttribute('href') || '')))
      .map((link) => ({ href: new URL(link.getAttribute('href'), location.href).toString(), text: clean(link.textContent || link.getAttribute('aria-label') || link.getAttribute('title')).slice(0, 180) }));
    const gridCandidate = [...document.querySelectorAll('main, [role="main"], [data-testid*="product" i], [data-automation-id*="product" i], [class*="product" i], [class*="grid" i], [class*="search" i]')]
      .filter(visible)
      .map((node) => clean(node.innerText || node.textContent))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0] || clean(document.body.innerText).slice(0, 4000);
    return {
      currentUrl: location.href,
      pageTitle: document.title,
      visibleTextAroundProductGrid: gridCandidate.slice(0, 4000),
      productLinksFound: productLinks.length,
      productLinkSamples: productLinks.slice(0, 25),
      bodyTextSample: clean(document.body.innerText).slice(0, 4000)
    };
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(htmlPath, await page.content());
  await writeFile(jsonPath, JSON.stringify({ ...debug, screenshotPath, htmlPath, savedAt: new Date().toISOString() }, null, 2));
  console.log(`Sam's Club Clearance debug: current URL=${debug.currentUrl}`);
  console.log(`Sam's Club Clearance debug: page title=${debug.pageTitle}`);
  console.log(`Sam's Club Clearance debug: visible text around product grid=${debug.visibleTextAroundProductGrid.slice(0, 1000)}`);
  console.log(`Sam's Club Clearance debug: number of product links found=${debug.productLinksFound}`);
  return { ...debug, screenshotPath, htmlPath, jsonPath };
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

async function extractListingProducts(page, dealSourceName = config.dealSource.name) {
  await loadMoreProductsIfAvailable(page);
  for (let i = 0; i < 2; i += 1) { await page.mouse.wheel(0, 1800).catch(() => undefined); await page.waitForTimeout(750); }
  return page.evaluate(productTileExtractorScript, { dealSourceName, relevantSources: config.relevantCategoryPatterns.map((p) => p.source), excludedSource: config.excludedCategoryPattern.source, varietySource: varietyPackPattern.source, filterAllowed: false, maxProducts: config.maxProducts });
}

async function visibleProductGridText(page) {
  return page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || '';
    const visible = (node) => {
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('main, [role="main"], [data-testid*="product" i], [data-automation-id*="product" i], [class*="product" i], [class*="grid" i], [class*="search" i]')]
      .filter(visible)
      .map((node) => clean(node.innerText || node.textContent))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0]?.slice(0, 1000) || clean(document.body.innerText).slice(0, 1000);
  });
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
    const { discoveredUrl, savingsUrl, location, dealSourceName, clearanceFound } = await navigateToClearance(page);
    const listingScreenshots = [];
    for (let i = 0; i < config.maxListingScreenshots; i += 1) { listingScreenshots.push(await saveStep(page, `01-clearance-listing-page-${i + 1}`)); await page.mouse.wheel(0, 1400).catch(() => undefined); await page.waitForTimeout(750); }
    const listingProducts = await extractListingProducts(page, dealSourceName);
    if (listingProducts.length === 0) {
      const debug = await saveZeroProductDebug(page);
      throw new Error(`Sam's Club Clearance had no detected visible product tiles. DOM debug saved to ${debug.jsonPath} and ${debug.htmlPath}.`);
    }
    console.log(`Sam's Club Clearance: current URL=${page.url()}`);
    console.log(`Sam's Club Clearance: page title=${await page.title().catch(() => '')}`);
    console.log(`Sam's Club Clearance: visible text around product grid=${await visibleProductGridText(page)}`);
    console.log(`Sam's Club Clearance: number of product links found=${listingProducts.length}`);
    const products = [];
    const rejectedProducts = [];
    for (const [index, product] of listingProducts.slice(0, config.maxProducts).entries()) {
      const enrichedProduct = await enrichProductFromPage(page, product, index);
      const rejectionReasons = productRejectionReasons(enrichedProduct);
      if (rejectionReasons.length === 0) { products.push(enrichedProduct); await saveProgress(products); }
      else rejectedProducts.push({ product: enrichedProduct, reasons: rejectionReasons });
    }
    const evaluatedProducts = await saveProgress(products);
    await writeFile(path.join(logDir, 'deal-execution-report.json'), JSON.stringify({ connector: config.supplier, sourceReports: [{ dealSource: dealSourceName, clearanceFound, savingsUrl, discoveredUrl, productCount: products.length, scrapedProductLimit: config.maxProducts, skippedByLimitCount: Math.max(listingProducts.length - config.maxProducts, 0), listingScreenshots }], productCount: products.length, rejectedProducts: rejectedProducts.map(({ product, reasons }) => ({ productName: product.productName, sku: product.sku, productUrl: product.productUrl, rejectionReasons: reasons })), outputs: { dealProducts: dealProductsPath, shoppingListReport: shoppingListReportPath }, businessRules: { global50TocRules: true, clearanceOnly: clearanceFound, savingsFallbackUsed: !clearanceFound, regularCatalogPagesScraped: false, clubLocation: config.clubLocation, location, didLogin: false, usedPassword: false, usedMembershipAuthentication: false, didAddToCart: false, didCheckout: false, didPurchase: false, maxProductsConfig: 'SAMS_CLUB_MAX_CLEARANCE_PRODUCTS' }, categories: { allowed: config.relevantCategoryPatterns.map((pattern) => pattern.source), excluded: config.excludedCategoryPattern.source }, evaluatedProductCount: evaluatedProducts.length, screenshotsDirectory: screenshotDir, logsDirectory: logDir, consoleMessages, completedAt: new Date().toISOString() }, null, 2));
  });
});
