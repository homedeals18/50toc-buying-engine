import { chromium, expect, test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/bjs');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const manualChromeEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const browserMode = process.env.BJS_BROWSER_MODE ?? 'playwright';
const manualLoginTimeout = Number(process.env.BJS_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60_000);
const maxListingScreenshots = Number(process.env.BJS_CLEARANCE_MAX_LISTING_SCREENSHOTS ?? 3);
const maxProductPages = Number(process.env.BJS_CLEARANCE_MAX_PRODUCT_PAGES ?? 12);

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

async function searchSiteForClearance(page) {
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
      await searchBox.fill('clearance');
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined),
        searchBox.press('Enter')
      ]);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await failIfAccessDenied(page, 'clearance-search-results');
      return true;
    }
  }
  return false;
}

async function navigateToClearance(page) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, 'homepage-clearance');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await clickCookieOrModalDismissers(page);

  const directClearanceLink = page.locator('a:has-text("Clearance"), button:has-text("Clearance")').first();
  if (await directClearanceLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await clickAndWaitForNavigation(page, directClearanceLink, 'clearance-link');
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
        const nestedClearanceLink = page.locator('a:has-text("Clearance"), button:has-text("Clearance")').first();
        if (await nestedClearanceLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await clickAndWaitForNavigation(page, nestedClearanceLink, 'clearance-menu-link');
          break;
        }
      }
    }
  }

  if (!/clearance/i.test(page.url())) {
    const searched = await searchSiteForClearance(page);
    if (!searched) {
      const screenshotPath = await saveStep(page, 'clearance-navigation-failed-no-search');
      throw new Error(`Unable to locate BJ's Clearance through homepage navigation or site search controls. Reached ${page.url()}. Screenshot saved to ${screenshotPath}.`);
    }
  }

  const searchResultClearanceLink = page.locator('a:has-text("Clearance"), button:has-text("Clearance")').first();
  if (!/clearance/i.test(page.url()) && await searchResultClearanceLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await clickAndWaitForNavigation(page, searchResultClearanceLink, 'clearance-search-result-link');
  }

  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await failIfAccessDenied(page, 'clearance-page');
  const hasProductTiles = await productCardLocators(page).first().isVisible({ timeout: 10_000 }).catch(() => false);
  const screenshotPath = await saveStep(page, hasProductTiles ? '04-clearance-page' : '04-clearance-page-no-products', { hasProductTiles });
  if (!hasProductTiles) {
    throw new Error(`BJ's Clearance navigation reached ${page.url()}, but no product tiles were visible. Screenshot saved to ${screenshotPath}.`);
  }
  await writeFile(path.join(logDir, 'clearance-url.txt'), `${page.url()}\n`);
  return page.url();
}

function productCardLocators(page) {
  return page.locator('[data-testid*="product" i], [class*="product-card" i], [class*="productTile" i], [class*="product-tile" i], li:has(a[href*="/product"]), div:has(> a[href*="/product"])');
}


async function extractListingProducts(page) {
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);
  await page.mouse.wheel(0, 1800).catch(() => undefined);
  await page.waitForTimeout(1_000);

  return page.evaluate(() => {
    const absUrl = (value) => {
      if (!value) return null;
      try { return new URL(value, location.href).toString(); } catch { return null; }
    };
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const priceMatches = (text) => [...text.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
    const cardNodes = [...document.querySelectorAll('[data-testid*="product" i], [class*="product-card" i], [class*="productTile" i], [class*="product-tile" i], li, article')]
      .filter((node) => node.querySelector('a[href*="/product"], a[href*="/p/"]') && /\$|clearance|save|off|coupon|available|stock/i.test(node.textContent || ''));

    const seen = new Set();
    return cardNodes.map((card) => {
      const link = card.querySelector('a[href*="/product"], a[href*="/p/"]');
      const url = absUrl(link?.getAttribute('href'));
      if (!url || seen.has(url)) return null;
      seen.add(url);
      const text = clean(card.textContent) || '';
      const prices = priceMatches(text);
      const image = card.querySelector('img');
      const name = clean(card.querySelector('[data-testid*="name" i], [class*="name" i], h2, h3, a[href*="/product"], a[href*="/p/"]')?.textContent) || clean(image?.getAttribute('alt'));
      return {
        name,
        sku: clean(text.match(/(?:SKU|Item|Item #|Model)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]),
        price: prices[0] ?? null,
        originalPrice: prices[1] ?? null,
        discount: clean(text.match(/(?:save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off|clearance)/i)?.[0]),
        availability: clean(text.match(/(?:in stock|out of stock|available|pickup|delivery|shipping|same-day delivery)[^.]{0,80}/i)?.[0]),
        packageSize: clean(text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]),
        productUrl: url,
        imageUrl: absUrl(image?.currentSrc || image?.getAttribute('src')),
        coupons: clean(text.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0]),
        quantityLimits: clean(text.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0])
      };
    }).filter(Boolean);
  });
}

async function enrichProductFromPage(page, listingProduct, index) {
  await gotoAndCheck(page, listingProduct.productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }, `clearance-product-${index + 1}`);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfAccessDenied(page, `clearance-product-${index + 1}`);
  const screenshotPath = await saveStep(page, `05-clearance-product-${String(index + 1).padStart(2, '0')}`);

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
    return {
      name: clean(productJson.name) || clean(document.querySelector('h1, [data-testid*="product-name" i]')?.textContent),
      sku: clean(productJson.sku) || clean(bodyText.match(/(?:SKU|Item|Item #|Model)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]),
      price: offer?.price ? String(offer.price) : prices[0] ?? null,
      originalPrice: prices[1] ?? null,
      discount: clean(bodyText.match(/(?:save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off|clearance)/i)?.[0]),
      availability: clean(offer?.availability) || clean(bodyText.match(/(?:in stock|out of stock|available|pickup|delivery|shipping|same-day delivery)[^.]{0,100}/i)?.[0]),
      packageSize: clean(bodyText.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]),
      productUrl: location.href,
      imageUrl: absUrl(Array.isArray(productJson.image) ? productJson.image[0] : productJson.image) || absUrl(image?.currentSrc || image?.getAttribute('src')),
      coupons: clean(bodyText.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0]),
      quantityLimits: clean(bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0])
    };
  });

  return { ...listingProduct, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value)), screenshotPath };
}

test.describe("BJ's clearance discovery automation", () => {
  test('discovers and scrapes BJ\'s clearance product listings without cart or checkout actions', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

    const auth = await ensureAuthenticated(page);
    const discoveredClearanceUrl = await navigateToClearance(page);
    const listingScreenshots = [];
    for (let i = 0; i < maxListingScreenshots; i += 1) {
      listingScreenshots.push(await saveStep(page, `04-clearance-listing-page-${i + 1}`));
      await page.mouse.wheel(0, 1400).catch(() => undefined);
      await page.waitForTimeout(750);
    }

    const listingProducts = await extractListingProducts(page);
    if (listingProducts.length === 0) {
      const screenshotPath = await saveStep(page, 'clearance-page-no-scrapable-products');
      throw new Error(`BJ's Clearance navigation reached ${page.url()}, but no scrapable product tiles were found. Screenshot saved to ${screenshotPath}.`);
    }

    const products = [];
    for (const [index, product] of listingProducts.slice(0, maxProductPages).entries()) {
      products.push(await enrichProductFromPage(page, product, index));
    }
    for (const product of listingProducts.slice(maxProductPages)) {
      products.push(product);
    }

    await writeFile(path.join(logDir, 'clearance-products.json'), JSON.stringify(products, null, 2));
    await writeFile(path.join(logDir, 'clearance-execution-report.json'), JSON.stringify({
      auth,
      discoveredClearanceUrl,
      productCount: products.length,
      enrichedProductCount: Math.min(listingProducts.length, maxProductPages),
      maxProductPages,
      stoppedBeforeCart: true,
      stoppedBeforeCheckout: true,
      didNotAddToCart: true,
      didNotPlaceOrder: true,
      screenshotsDirectory: screenshotDir,
      listingScreenshots,
      logsDirectory: logDir,
      consoleMessages,
      completedAt: new Date().toISOString()
    }, null, 2));
  });
});
