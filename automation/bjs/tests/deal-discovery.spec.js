import { chromium, test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/bjs');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const manualChromeEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const browserMode = process.env.BJS_BROWSER_MODE ?? 'playwright';
const manualLoginTimeout = Number(process.env.BJS_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60_000);
const maxListingScreenshots = Number(process.env.BJS_DEALS_MAX_LISTING_SCREENSHOTS ?? 2);
const maxProductPagesPerDealSource = Number(process.env.BJS_DEALS_MAX_PRODUCT_PAGES ?? 12);
const dealSources = [
  { name: 'Clearance', searchTerm: 'clearance' },
  { name: 'Wow Deals', searchTerm: 'wow deals' }
];

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
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(
    path.join(logDir, `${safeName}.json`),
    JSON.stringify({ ...details, url: page.url(), title: await page.title().catch(() => ''), savedAt: new Date().toISOString(), screenshotPath }, null, 2)
  );
  return screenshotPath;
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

function productCardLocators(page) {
  return page.locator('[data-testid*="product" i], [class*="product-card" i], [class*="productTile" i], [class*="product-tile" i], li:has(a[href*="/product"]), li:has(a[href*="/p/"]), article:has(a[href*="/product"]), article:has(a[href*="/p/"])');
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
  const hasProductTiles = await productCardLocators(page).first().isVisible({ timeout: 10_000 }).catch(() => false);
  const screenshotPath = await saveStep(page, hasProductTiles ? `04-${dealSource.name}-page` : `04-${dealSource.name}-page-no-products`, { hasProductTiles });
  if (!hasProductTiles) {
    throw new Error(`BJ's ${dealSource.name} navigation reached ${page.url()}, but no product tiles were visible. Screenshot saved to ${screenshotPath}.`);
  }
  await writeFile(path.join(logDir, `${dealSource.name.toLowerCase().replace(/\s+/g, '-')}-url.txt`), `${page.url()}\n`);
  return page.url();
}

async function extractListingProducts(page, dealSource) {
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);

  return page.evaluate(({ dealSourceName }) => {
    const absUrl = (value) => {
      if (!value) return null;
      try { return new URL(value, location.href).toString(); } catch { return null; }
    };
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const priceMatches = (text) => [...text.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
    const cardNodes = [...document.querySelectorAll('[data-testid*="product" i], [class*="product-card" i], [class*="productTile" i], [class*="product-tile" i], li, article')]
      .filter((node) => node.querySelector('a[href*="/product"], a[href*="/p/"]') && /\$|clearance|wow|save|off|coupon|available|stock/i.test(node.textContent || ''));

    const seen = new Set();
    return cardNodes.map((card) => {
      const link = card.querySelector('a[href*="/product"], a[href*="/p/"]');
      const productUrl = absUrl(link?.getAttribute('href'));
      if (!productUrl || seen.has(productUrl)) return null;
      seen.add(productUrl);
      const text = clean(card.textContent) || '';
      const prices = priceMatches(text);
      const image = card.querySelector('img');
      const productName = clean(card.querySelector('[data-testid*="name" i], [class*="name" i], h2, h3, a[href*="/product"], a[href*="/p/"]')?.textContent) || clean(image?.getAttribute('alt'));
      return {
        supplier: "BJ's Wholesale Club",
        dealSource: dealSourceName,
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
        amazonProfitCheck: {
          status: 'pending',
          lookupKeys: { upc: null, sku: null, brand: null, productName, packageSize: null }
        }
      };
    }).filter(Boolean);
  }, { dealSourceName: dealSource.name });
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
    return {
      productName,
      brand,
      sku,
      upc,
      packageSize,
      currentPrice: offer?.price ? String(offer.price) : prices[0] ?? null,
      originalPrice: prices[1] ?? null,
      discount: clean(bodyText.match(/(?:save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off|clearance|wow deal)/i)?.[0]),
      coupon: clean(bodyText.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0]),
      availability: clean(offer?.availability) || clean(bodyText.match(/(?:in stock|out of stock|available|pickup|delivery|shipping|same-day delivery)[^.]{0,100}/i)?.[0]),
      quantityLimit: clean(bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]),
      productUrl: location.href,
      imageUrl: absUrl(Array.isArray(productJson.image) ? productJson.image[0] : productJson.image) || absUrl(image?.currentSrc || image?.getAttribute('src')),
      amazonProfitCheck: {
        status: 'pending',
        lookupKeys: { upc, sku, brand, productName, packageSize }
      }
    };
  });

  return { ...listingProduct, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value)), screenshotPath };
}

function buildShoppingListReport(products) {
  return products.map((product) => ({
    recommendedStore: product.supplier,
    product: product.productName,
    price: product.currentPrice,
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
      'Amazon profit check: pending'
    ].filter(Boolean).join(' | ')
  }));
}

test.describe("BJ's store shopping list intelligence", () => {
  test('scrapes Clearance and Wow Deals data only, without cart or checkout actions', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

    const auth = await ensureAuthenticated(page);
    const sourceReports = [];
    const products = [];

    for (const dealSource of dealSources) {
      const discoveredUrl = await navigateToDealSource(page, dealSource);
      const listingScreenshots = [];
      for (let i = 0; i < maxListingScreenshots; i += 1) {
        listingScreenshots.push(await saveStep(page, `04-${dealSource.name}-listing-page-${i + 1}`));
        await page.mouse.wheel(0, 1400).catch(() => undefined);
        await page.waitForTimeout(750);
      }

      const listingProducts = await extractListingProducts(page, dealSource);
      if (listingProducts.length === 0) {
        const screenshotPath = await saveStep(page, `${dealSource.name}-page-no-scrapable-products`);
        throw new Error(`BJ's ${dealSource.name} navigation reached ${page.url()}, but no scrapable product tiles were found. Screenshot saved to ${screenshotPath}.`);
      }

      const sourceProducts = [];
      for (const [index, product] of listingProducts.slice(0, maxProductPagesPerDealSource).entries()) {
        sourceProducts.push(await enrichProductFromPage(page, product, index));
      }
      sourceProducts.push(...listingProducts.slice(maxProductPagesPerDealSource));
      products.push(...sourceProducts);
      sourceReports.push({
        dealSource: dealSource.name,
        discoveredUrl,
        productCount: sourceProducts.length,
        enrichedProductCount: Math.min(listingProducts.length, maxProductPagesPerDealSource),
        listingScreenshots
      });
    }

    const shoppingList = buildShoppingListReport(products);
    await writeFile(path.join(logDir, 'deal-products.json'), JSON.stringify(products, null, 2));
    await writeFile(path.join(logDir, 'shopping-list-report.json'), JSON.stringify(shoppingList, null, 2));
    await writeFile(path.join(logDir, 'deal-execution-report.json'), JSON.stringify({
      auth,
      sourceReports,
      productCount: products.length,
      maxProductPagesPerDealSource,
      outputs: {
        dealProducts: path.join(logDir, 'deal-products.json'),
        shoppingListReport: path.join(logDir, 'shopping-list-report.json')
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
