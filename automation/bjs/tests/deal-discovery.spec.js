import { chromium, test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runBuyingPipeline, writeCombinedShoppingListReport } from '../../shared/buying-engine.js';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/bjs');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const manualChromeEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const browserMode = process.env.BJS_BROWSER_MODE ?? 'playwright';
const manualLoginTimeout = Number(process.env.BJS_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60_000);
const maxListingScreenshots = Number(process.env.BJS_DEALS_MAX_LISTING_SCREENSHOTS ?? 2);
const dealSources = [
  { name: 'Clearance', searchTerm: 'clearance', maxProducts: Number(process.env.BJS_MAX_CLEARANCE_PRODUCTS ?? process.env.BJS_DEALS_MAX_PRODUCT_PAGES ?? 12) },
  { name: 'Wow Deals', searchTerm: 'wow deals', maxProducts: Number(process.env.BJS_MAX_WOW_DEALS_PRODUCTS ?? process.env.BJS_DEALS_MAX_PRODUCT_PAGES ?? 12) }
];
const relevantCategoryPatterns = [/grocery/i, /health\s*&\s*beauty/i, /health\s*&\s*household/i];
const unrelatedDepartmentPattern = /furniture|patio|garden|outdoor|appliance|electronics?|toys?|clothing|apparel|automotive|seasonal|lawn|grill|sporting goods|jewelry|office|books?|mattress|tires?/i;
const dealProductsPath = path.join(logDir, 'deal-products.json');
const shoppingListReportPath = path.join(logDir, 'shopping-list-report.json');

async function ensureArtifactDirs() {
  await Promise.all([
    mkdir(screenshotDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(profileDir, { recursive: true })
  ]);
}

async function failIfAccessDenied(page, label = 'current page') {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  const url = page.url();
  if (/access\s+denied/i.test(`${title}\n${body}`)) {
    await saveStep(page, `access-denied-${label}`);
    throw new Error(`BJ's Access Denied detected on ${label} (${url}). Stop immediately; the persistent profile may need manual verification or BJ's may be blocking automation.`);
  }
}

function bjsUrl(pathname = '/') {
  return new URL(pathname, 'https://www.bjs.com').toString();
}

async function gotoAndCheck(page, url, options = {}, label = String(url)) {
  const response = await page.goto(bjsUrl(url), options);
  await failIfAccessDenied(page, label);
  return response;
}

const test = base.extend({
  context: async ({}, use) => {
    await ensureArtifactDirs();

    if (browserMode === 'manual-chrome') {
      let browser;
      try {
        browser = await chromium.connectOverCDP(manualChromeEndpoint);
      } catch (error) {
        throw new Error(`Unable to connect to manual Chrome at ${manualChromeEndpoint}. Start regular Chrome with --remote-debugging-port=9222 and a dedicated profile folder before running this mode. Original error: ${error.message}`);
      }
      const context = browser.contexts()[0] ?? await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      try {
        await use(context);
      } finally {
        await browser.close();
      }
      return;
    }

    const context = await chromium.launchPersistentContext(profileDir, {
      baseURL: 'https://www.bjs.com',
      headless: false,
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    });
    try {
      await use(context);
    } finally {
      await context.close();
    }
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
  let savedScreenshotPath = screenshotPath;
  let screenshotError = null;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (error) {
    savedScreenshotPath = null;
    screenshotError = error.message;
    console.warn(`BJ's screenshot capture failed for ${name}: ${error.message}`);
  }
  await writeFile(
    path.join(logDir, `${safeName}.json`),
    JSON.stringify({ ...details, url: page.url(), title: await page.title().catch(() => ''), savedAt: new Date().toISOString(), screenshotPath: savedScreenshotPath, screenshotError }, null, 2)
  );
  return savedScreenshotPath;
}

async function clickCookieOrModalDismissers(page) {
  const dismissers = [
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    'button[aria-label*="close" i]',
    'button:has-text("No Thanks")'
  ];
  for (const selector of dismissers) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await button.click({ timeout: 2_000 }).catch(() => undefined);
    }
  }
}

async function isAuthenticated(page) {
  await clickCookieOrModalDismissers(page);
  const body = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  if (/sign\s*in|log\s*in/i.test(body) && !/account|membership|sign\s*out|log\s*out/i.test(body)) return false;
  return Boolean(
    (await page.locator('text=/sign\\s*out|log\\s*out|my\\s+account|account|membership/i').first().isVisible({ timeout: 3_000 }).catch(() => false)) ||
      /sign\s*out|log\s*out|my\s+account|membership/i.test(body)
  );
}

async function ensureAuthenticated(page) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, 'homepage');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await clickCookieOrModalDismissers(page);
  await saveStep(page, '01-bjs-homepage-before-auth-check');

  if (await isAuthenticated(page)) {
    return { authenticated: true, profileDir: browserMode === 'manual-chrome' ? 'manual-chrome-existing-profile' : profileDir, loginMode: browserMode === 'manual-chrome' ? 'manual-chrome-existing-session' : 'reused-persistent-profile' };
  }

  const signIn = page.locator('a:has-text("Sign In"), button:has-text("Sign In"), text=/sign\\s*in|log\\s*in/i').first();
  if (await signIn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await signIn.click({ timeout: 5_000 }).catch(() => undefined);
  }

  await saveStep(page, '02-bjs-login-required');
  console.log(`BJ's login is required. Complete login in the opened headed Chromium browser. The test will wait up to ${manualLoginTimeout} ms, then reuse the persistent profile at ${profileDir} on future runs.`);
  await page.waitForFunction(() => /sign\s*out|log\s*out|my\s+account|membership|account/i.test(document.body.innerText), null, { timeout: manualLoginTimeout });
  await failIfAccessDenied(page, 'post-login');
  await saveStep(page, '03-bjs-login-complete');
  return { authenticated: true, profileDir: browserMode === 'manual-chrome' ? 'manual-chrome-existing-profile' : profileDir, loginMode: browserMode === 'manual-chrome' ? 'manual-login-in-existing-chrome-session' : 'manual-login-saved-to-persistent-profile' };
}

async function clickAndWaitForNavigation(page, locator, label) {
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined),
    locator.click({ timeout: 10_000 })
  ]);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await failIfAccessDenied(page, label);
}

const bjsProductLinkSelector = 'a[href*="/product/"]';

// BJ's category/search pages currently render product tiles as generic grid divs,
// not the older product-card/productTile/product-tile class names. The stable
// signals observed on the current DOM are product detail anchors
// (`a[href*="/product/"]`) inside grid/list tile containers with
// price, image, pickup/delivery/shipping, and rating text. Keep the legacy
// class/data-testid selectors below as fallbacks, but discover products from
// product links first so generic div-based tiles are not missed.
const bjsProductTileSelector = [
  'div:has(> a[href*="/product/"])',
  '[data-testid*="product" i]:has(a[href*="/product/"])',
  '[class*="product-card" i]:has(a[href*="/product/"])',
  '[class*="productTile" i]:has(a[href*="/product/"])',
  '[class*="product-tile" i]:has(a[href*="/product/"])',
  'li:has(a[href*="/product/"])',
  'article:has(a[href*="/product/"])'
].join(', ');

function productCardLocators(page) {
  return page.locator(bjsProductTileSelector);
}

async function expectedResultCount(page) {
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  return Number(body.match(/\((\d+)\s+Results\)|Showing\s+\d+\s+of\s+(\d+)\s+Results/i)?.slice(1).find(Boolean) ?? 0);
}

async function loadMoreProductsIfAvailable(page) {
  const expected = await expectedResultCount(page);
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const detected = await page.locator(bjsProductLinkSelector).evaluateAll((links) => new Set(links.map((link) => link.href).filter(Boolean)).size).catch(() => 0);
    if (expected && detected >= expected) break;
    const loadMore = page.locator('button:has-text("Load More"), a:has-text("Load More")').first();
    if (!(await loadMore.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await loadMore.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }
}

async function searchSiteForDealSource(page, dealSource) {
  const searchSelectors = [
    'input[type="search"]',
    'input[placeholder*="search" i]',
    'input[aria-label*="search" i]',
    '[data-testid*="search" i] input',
    'form[role="search"] input'
  ];
  for (const selector of searchSelectors) {
    const searchBox = page.locator(selector).first();
    if (await searchBox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchBox.fill(dealSource.searchTerm);
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined),
        searchBox.press('Enter')
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await failIfAccessDenied(page, `${dealSource.name}-search-results`);
      return true;
    }
  }
  return false;
}

async function navigateToDealSource(page, dealSource) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, `${dealSource.name}-homepage`);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await clickCookieOrModalDismissers(page);

  const linkPattern = new RegExp(dealSource.name.replace(/\s+/g, '\\s+'), 'i');
  const directDealLink = page.locator('a, button').filter({ hasText: linkPattern }).first();
  if (await directDealLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await clickAndWaitForNavigation(page, directDealLink, `${dealSource.name}-link`);
  } else {
    const menuTriggers = [
      'button:has-text("Shop")',
      'a:has-text("Shop")',
      'button:has-text("Categories")',
      'a:has-text("Categories")',
      'button[aria-label*="menu" i]',
      'button[aria-label*="shop" i]',
      'button[aria-label*="categories" i]'
    ];
    for (const selector of menuTriggers) {
      const trigger = page.locator(selector).first();
      if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await trigger.click({ timeout: 5_000 }).catch(() => undefined);
        await page.waitForTimeout(1_000);
        const nestedDealLink = page.locator('a, button').filter({ hasText: linkPattern }).first();
        if (await nestedDealLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await clickAndWaitForNavigation(page, nestedDealLink, `${dealSource.name}-menu-link`);
          break;
        }
      }
    }
  }

  if (!new RegExp(dealSource.searchTerm.replace(/\s+/g, '|'), 'i').test(page.url())) {
    const searched = await searchSiteForDealSource(page, dealSource);
    if (!searched) {
      const screenshotPath = await saveStep(page, `${dealSource.name}-navigation-failed-no-search`);
      throw new Error(`Unable to locate BJ's ${dealSource.name} through homepage navigation or site search controls. Reached ${page.url()}. Screenshot saved to ${screenshotPath}.`);
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await failIfAccessDenied(page, `${dealSource.name}-page`);
  const hasProductTiles = await page.locator(bjsProductLinkSelector).first().isVisible({ timeout: 10_000 }).catch(() => false);
  const screenshotPath = await saveStep(page, hasProductTiles ? `04-${dealSource.name}-page` : `04-${dealSource.name}-page-no-products`, { hasProductTiles });
  if (!hasProductTiles) {
    throw new Error(`BJ's ${dealSource.name} navigation reached ${page.url()}, but no product tiles were visible. Screenshot saved to ${screenshotPath}.`);
  }
  await writeFile(path.join(logDir, `${dealSource.name.toLowerCase().replace(/\s+/g, '-')}-url.txt`), `${page.url()}\n`);
  return page.url();
}

function categoryAllowed(product) {
  const category = product.category;
  if (!category) return true;
  return relevantCategoryPatterns.some((pattern) => pattern.test(category)) && !unrelatedDepartmentPattern.test(category);
}


function unifiedDeal(product) {
  const scanDate = product.scanDate ?? new Date().toISOString();
  return {
    supplier: product.supplier ?? "BJ's Wholesale Club",
    dealSource: product.dealSource ?? null,
    category: product.category ?? null,
    productName: product.productName ?? null,
    brand: product.brand ?? null,
    sku: product.sku ?? null,
    upc: product.upc ?? null,
    packageSize: product.packageSize ?? null,
    currentPrice: product.currentPrice ?? null,
    originalPrice: product.originalPrice ?? null,
    discount: product.discount ?? null,
    coupon: product.coupon ?? null,
    availability: product.availability ?? null,
    quantityLimit: product.quantityLimit ?? null,
    productUrl: product.productUrl ?? null,
    imageUrl: product.imageUrl ?? null,
    scanDate
  };
}

async function saveProgress(products) {
  await ensureArtifactDirs();
  const unifiedProducts = products.map(unifiedDeal).filter(categoryAllowed);
  const evaluatedProducts = await runBuyingPipeline(unifiedProducts);
  await writeFile(dealProductsPath, JSON.stringify(evaluatedProducts, null, 2));
  await writeCombinedShoppingListReport("BJ's Wholesale Club", evaluatedProducts, shoppingListReportPath);
}

async function extractListingProducts(page, dealSource) {
  await loadMoreProductsIfAvailable(page);
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);

  return page.evaluate(({ dealSourceName, productLinkSelector, relevantCategorySources, unrelatedDepartmentSource }) => {
    const relevantCategoryPatterns = relevantCategorySources.map((source) => new RegExp(source, 'i'));
    const unrelatedDepartmentPattern = new RegExp(unrelatedDepartmentSource, 'i');
    const absUrl = (value) => {
      if (!value) return null;
      try { return new URL(value, location.href).toString(); } catch { return null; }
    };
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const priceMatches = (text) => [...text.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
    const findTile = (link) => {
      let node = link;
      for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
        const text = node.textContent || '';
        if (/\$|Pickup|Delivery|Shipping|clearance|wow|save|off|coupon|available|stock/i.test(text) && node.querySelector('img')) return node;
      }
      return link.closest('[data-testid*="product" i], [class*="product-card" i], [class*="productTile" i], [class*="product-tile" i], li, article, div') || link;
    };
    const categoryFrom = (card) => {
      const categoryText = clean(
        card.closest('[data-category], [data-department]')?.getAttribute('data-category') ||
        card.closest('[data-category], [data-department]')?.getAttribute('data-department') ||
        document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent ||
        [...document.querySelectorAll('a, button, [aria-checked="true"], [aria-selected="true"]')]
          .map((node) => node.textContent)
          .find((text) => relevantCategoryPatterns.some((pattern) => pattern.test(text || '')) || unrelatedDepartmentPattern.test(text || ''))
      );
      if (!categoryText) return null;
      if (unrelatedDepartmentPattern.test(categoryText)) return categoryText;
      return relevantCategoryPatterns.some((pattern) => pattern.test(categoryText)) ? categoryText : null;
    };
    const productLinks = [...document.querySelectorAll(productLinkSelector)]
      .filter((link) => link.offsetParent !== null && clean(link.textContent || link.getAttribute('aria-label') || link.querySelector('img')?.getAttribute('alt')));

    const seen = new Set();
    return productLinks.map((link) => {
      const productUrl = absUrl(link?.getAttribute('href'));
      const card = findTile(link);
      if (!productUrl || seen.has(productUrl)) return null;
      seen.add(productUrl);
      const text = clean(card.textContent) || '';
      const category = categoryFrom(card);
      if (category && (unrelatedDepartmentPattern.test(category) || !relevantCategoryPatterns.some((pattern) => pattern.test(category)))) return null;
      const prices = priceMatches(text);
      const image = card.querySelector('img');
      const productName = clean(card.querySelector('[data-testid*="name" i], [class*="name" i], h2, h3, a[href*="/product"], a[href*="/p/"]')?.textContent) || clean(image?.getAttribute('alt'));
      return {
        supplier: "BJ's Wholesale Club",
        dealSource: dealSourceName,
        category,
        productName,
        brand: null,
        sku: clean(text.match(/(?:SKU|Item|Item #|Model)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]),
        upc: null,
        packageSize: clean(text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]),
        currentPrice: prices[0] ?? null,
        originalPrice: prices[1] ?? null,
        discount: clean(text.match(/(?:save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off|clearance|wow deal)/i)?.[0]),
        coupon: clean(text.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0]),
        availability: clean(text.match(/(?:in stock|out of stock|available|pickup|delivery|shipping|same-day delivery)[^.]{0,80}/i)?.[0]),
        quantityLimit: clean(text.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]),
        productUrl,
        imageUrl: absUrl(image?.currentSrc || image?.getAttribute('src')),
        scanDate: new Date().toISOString()
      };
    }).filter(Boolean);
  }, {
    dealSourceName: dealSource.name,
    productLinkSelector: bjsProductLinkSelector,
    relevantCategorySources: relevantCategoryPatterns.map((pattern) => pattern.source),
    unrelatedDepartmentSource: unrelatedDepartmentPattern.source
  });
}

async function enrichProductFromPage(page, listingProduct, index) {
  await gotoAndCheck(page, listingProduct.productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }, `${listingProduct.dealSource}-product-${index + 1}`);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfAccessDenied(page, `${listingProduct.dealSource}-product-${index + 1}`);
  const screenshotPath = await saveStep(page, `05-${listingProduct.dealSource}-product-${String(index + 1).padStart(2, '0')}`);

  const details = await page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const bodyText = clean(document.body.innerText) || '';
    const image = document.querySelector('img[alt], img');
    const prices = [...bodyText.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
    const jsonProducts = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
      try { return [JSON.parse(node.textContent || 'null')].flat(Infinity); } catch { return []; }
    }).filter((entry) => /Product/i.test(String(entry?.['@type'] ?? '')));
    const productJson = jsonProducts[0] ?? {};
    const offer = Array.isArray(productJson.offers) ? productJson.offers[0] : productJson.offers;
    const absUrl = (value) => {
      if (!value) return null;
      try { return new URL(value, location.href).toString(); } catch { return null; }
    };
    const productName = clean(productJson.name) || clean(document.querySelector('h1, [data-testid*="product-name" i]')?.textContent);
    const packageSize = clean(bodyText.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]);
    const sku = clean(productJson.sku) || clean(bodyText.match(/(?:SKU|Item|Item #|Model)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]);
    const upc = clean(productJson.gtin12 || productJson.gtin13 || productJson.gtin14 || productJson.gtin) || clean(bodyText.match(/(?:UPC|GTIN)\s*[:#-]?\s*([0-9-]{8,14})/i)?.[1]);
    const brand = clean(typeof productJson.brand === 'string' ? productJson.brand : productJson.brand?.name) || clean(bodyText.match(/(?:Brand)\s*[:#-]?\s*([A-Za-z0-9 '&.-]{2,60})/i)?.[1]);
    const breadcrumbCategory = clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent);
    const category = breadcrumbCategory && (/furniture|patio|garden|outdoor|appliance|electronics?|toys?|clothing|apparel|automotive|seasonal|lawn|grill|sporting goods|jewelry|office|books?|mattress|tires?/i.test(breadcrumbCategory) || /grocery|health\s*&\s*beauty|health\s*&\s*household/i.test(breadcrumbCategory)) ? breadcrumbCategory : null;
    return {
      productName,
      brand,
      sku,
      upc,
      category,
      packageSize,
      currentPrice: offer?.price ? String(offer.price) : prices[0] ?? null,
      originalPrice: prices[1] ?? null,
      discount: clean(bodyText.match(/(?:save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off|clearance|wow deal)/i)?.[0]),
      coupon: clean(bodyText.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0]),
      availability: clean(offer?.availability) || clean(bodyText.match(/(?:in stock|out of stock|available|pickup|delivery|shipping|same-day delivery)[^.]{0,100}/i)?.[0]),
      quantityLimit: clean(bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]),
      productUrl: location.href,
      imageUrl: absUrl(Array.isArray(productJson.image) ? productJson.image[0] : productJson.image) || absUrl(image?.currentSrc || image?.getAttribute('src')),
      scanDate: new Date().toISOString()
    };
  });

  return unifiedDeal({ ...listingProduct, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value)), screenshotPath });
}



test.describe("BJ's store shopping list intelligence", () => {
  test.setTimeout(Number(process.env.BJS_DEALS_TEST_TIMEOUT_MS ?? 0));

  test('scrapes Clearance and Wow Deals data only, without cart or checkout actions', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

    const auth = await ensureAuthenticated(page);
    const sourceReports = [];
    const products = [];
    const runCounts = { attempted: 0, accepted: 0, rejected: 0, failed: 0 };

    for (const dealSource of dealSources) {
      const discoveredUrl = await navigateToDealSource(page, dealSource);
      const listingScreenshots = [];
      for (let i = 0; i < maxListingScreenshots; i += 1) {
        listingScreenshots.push(await saveStep(page, `04-${dealSource.name}-listing-page-${i + 1}`));
        await page.mouse.wheel(0, 1400).catch(() => undefined);
        await page.waitForTimeout(750);
      }

      const listingProducts = await extractListingProducts(page, dealSource);
      const expectedProducts = await expectedResultCount(page);
      console.log(`BJ's ${dealSource.name}: detected ${listingProducts.length} product tiles before opening product pages${expectedProducts ? ` (page reports ${expectedProducts} Results)` : ''}.`);
      if (listingProducts.length === 0) {
        const screenshotPath = await saveStep(page, `${dealSource.name}-page-no-scrapable-products`);
        throw new Error(`BJ's ${dealSource.name} navigation reached ${page.url()}, but no scrapable product tiles were found. Screenshot saved to ${screenshotPath}.`);
      }

      const sourceProducts = [];
      const counts = { attempted: 0, accepted: 0, rejected: 0, failed: 0 };
      const failures = [];
      for (const [index, product] of listingProducts.entries()) {
        if (sourceProducts.length >= dealSource.maxProducts) break;
        counts.attempted += 1;
        try {
          const enrichedProduct = await enrichProductFromPage(page, product, index);
          if (categoryAllowed(enrichedProduct)) {
            sourceProducts.push(enrichedProduct);
            products.push(enrichedProduct);
            counts.accepted += 1;
            await saveProgress(products);
          } else {
            counts.rejected += 1;
            console.log(`BJ's ${dealSource.name}: skipped unrelated category "${enrichedProduct.category}" for ${enrichedProduct.productName ?? enrichedProduct.productUrl}.`);
          }
        } catch (error) {
          counts.failed += 1;
          failures.push({ productUrl: product.productUrl, productName: product.productName, error: error.message });
          console.warn(`BJ's ${dealSource.name}: failed to scrape ${product.productName ?? product.productUrl}: ${error.message}`);
        }
      }
      runCounts.attempted += counts.attempted;
      runCounts.accepted += counts.accepted;
      runCounts.rejected += counts.rejected;
      runCounts.failed += counts.failed;

      sourceReports.push({
        dealSource: dealSource.name,
        discoveredUrl,
        productCount: sourceProducts.length,
        scrapedProductLimit: dealSource.maxProducts,
        skippedByLimitCount: Math.max(listingProducts.length - counts.attempted, 0),
        attemptedCount: counts.attempted,
        acceptedCount: counts.accepted,
        rejectedCount: counts.rejected,
        failedCount: counts.failed,
        failures,
        listingScreenshots
      });
    }

    await saveProgress(products);
    await writeFile(path.join(logDir, 'deal-execution-report.json'), JSON.stringify({
      auth,
      sourceReports,
      productCount: products.length,
      attemptedCount: runCounts.attempted,
      acceptedCount: runCounts.accepted,
      rejectedCount: runCounts.rejected,
      failedCount: runCounts.failed,
      productLimits: Object.fromEntries(dealSources.map((source) => [source.name, source.maxProducts])),
      outputs: {
        dealProducts: dealProductsPath,
        shoppingListReport: shoppingListReportPath
      },
      businessRules: {
        storeShoppingListOnly: true,
        purchasesMadePhysicallyInStoreBy50TocWorker: true,
        didNotAddToCart: true,
        didNotCheckout: true,
        didNotPlaceOrder: true
      },
      screenshotsDirectory: screenshotDir,
      logsDirectory: logDir,
      consoleMessages,
      completedAt: new Date().toISOString()
    }, null, 2));
  });
});
