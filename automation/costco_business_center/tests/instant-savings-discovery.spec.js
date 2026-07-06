import { chromium, test as base } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/costco_business_center');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const deliveryZipCode = process.env.COSTCO_BUSINESS_CENTER_DELIVERY_ZIP ?? '07601-6954';
const maxProducts = Number(process.env.COSTCO_BUSINESS_CENTER_MAX_INSTANT_SAVINGS_PRODUCTS ?? process.env.COSTCO_BUSINESS_CENTER_MAX_PRODUCT_PAGES ?? 12);
const dealSource = { name: 'All Online Instant Savings', searchTerm: 'Instant Savings' };
const maxListingScreenshots = Number(process.env.COSTCO_BUSINESS_CENTER_MAX_LISTING_SCREENSHOTS ?? 2);
const relevantCategoryPatterns = [/grocery/i, /dry\s+food/i, /candy\s*&\s*snacks/i, /snacks/i, /beverages?/i, /health\s*&\s*beauty/i, /health\s*&\s*household/i];
const globalExcludedPattern = /fresh produce|produce|meat|poultry|seafood|dairy|milk|cheese|yogurt|butter|eggs?|refrigerated|frozen|bakery|deli|furniture|patio|garden|electronics?|\btv\b|appliances?|clothing|apparel|toys?|automotive|office|pet|seasonal/i;
const varietyPackPattern = /variety\s+pack|assorted|mixed\s+flavo[u]?r|mixed\s+variety|sampler/i;
const dealProductsPath = path.join(logDir, 'deal-products.json');
const shoppingListReportPath = path.join(logDir, 'shopping-list-report.json');

async function ensureArtifactDirs() {
  await Promise.all([mkdir(screenshotDir, { recursive: true }), mkdir(logDir, { recursive: true }), mkdir(profileDir, { recursive: true })]);
}

function costcoUrl(pathname = '/') {
  return new URL(pathname, 'https://www.costcobusinessdelivery.com').toString();
}

async function failIfBlocked(page, label = 'current page') {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  if (/access\s+denied|forbidden|captcha|robot/i.test(`${title}\n${body}`)) {
    const screenshotPath = await saveStep(page, `blocked-${label}`);
    throw new Error(`Costco Business Center blocking or access challenge detected on ${label} (${page.url()}). Screenshot saved to ${screenshotPath}.`);
  }
}

async function gotoAndCheck(page, url, options = {}, label = String(url)) {
  const response = await page.goto(costcoUrl(url), options);
  await failIfBlocked(page, label);
  return response;
}

const test = base.extend({
  context: async ({}, use) => {
    await ensureArtifactDirs();
    const context = await chromium.launchPersistentContext(profileDir, {
      baseURL: 'https://www.costcobusinessdelivery.com',
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


async function saveDomDebug(page, name, details = {}) {
  await ensureArtifactDirs();
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const screenshotPath = await saveStep(page, name, details);
  const [html, bodyText, anchorSamples, productSignalSummary] = await Promise.all([
    page.content().catch(() => ''),
    page.locator('body').innerText({ timeout: 5_000 }).catch(() => ''),
    page.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 300).map((anchor) => ({
      href: anchor.href,
      text: anchor.textContent?.replace(/\s+/g, ' ').trim() || null,
      ariaLabel: anchor.getAttribute('aria-label'),
      title: anchor.getAttribute('title'),
      imgAlt: anchor.querySelector('img')?.getAttribute('alt') || null,
      visible: !!(anchor.offsetWidth || anchor.offsetHeight || anchor.getClientRects().length)
    }))).catch(() => []),
    page.evaluate(() => {
      const hrefs = [...document.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href') || '');
      return {
        anchorCount: hrefs.length,
        productLikeAnchorCount: hrefs.filter((href) => /(?:\/p\/|\/product(?:[/?#]|$)|\.product\.\d+\.html|ProductDisplay|productId=|partNumber=)/i.test(href)).length,
        itemTextMatchCount: (document.body.innerText.match(/(?:Item\s*#?|SKU)\s*[:#-]?\s*[A-Z0-9-]{3,}/gi) || []).length,
        priceTextMatchCount: (document.body.innerText.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g) || []).length
      };
    }).catch(() => ({}))
  ]);
  await writeFile(path.join(logDir, `${safeName}.html`), html);
  await writeFile(path.join(logDir, `${safeName}-text.txt`), bodyText);
  await writeFile(path.join(logDir, `${safeName}.json`), JSON.stringify({ ...details, url: page.url(), title: await page.title().catch(() => ''), anchorSamples, productSignalSummary, savedAt: new Date().toISOString(), screenshotPath }, null, 2));
  return screenshotPath;
}

async function clickCookieOrModalDismissers(page) {
  for (const selector of ['button:has-text("Accept")', 'button:has-text("I Agree")', 'button:has-text("Got it")', 'button[aria-label*="close" i]', 'button:has-text("No Thanks")']) {
    const button = page.locator(selector).first();
    if (await button.isVisible({ timeout: 1_000 }).catch(() => false)) await button.click({ timeout: 2_000 }).catch(() => undefined);
  }
}

async function readDeliveryPageText(page) {
  return page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
}

async function assertDeliveryZipConfirmed(page, mode) {
  const body = await readDeliveryPageText(page);
  if (body.includes(deliveryZipCode)) {
    await saveStep(page, '03-after-zip-confirmation', { deliveryZipCode, mode, confirmed: true });
    return { deliveryZipCode, accepted: true, mode, confirmedText: deliveryZipCode };
  }

  const screenshotPath = await saveStep(page, 'delivery-zip-not-confirmed', { deliveryZipCode, mode, bodyPreview: body.slice(0, 2_000) });
  throw new Error(`Costco Business Center did not confirm delivery ZIP/location ${deliveryZipCode}; refusing to search Instant Savings. Screenshot saved to ${screenshotPath}.`);
}

async function ensureDeliveryZipCode(page) {
  await gotoAndCheck(page, '/', { waitUntil: 'domcontentloaded', timeout: 60_000 }, 'homepage');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await clickCookieOrModalDismissers(page);
  await saveStep(page, '01-before-entering-zip', { deliveryZipCode });

  const initialBody = await readDeliveryPageText(page);
  if (initialBody.includes(deliveryZipCode)) return assertDeliveryZipConfirmed(page, 'already-set');

  const triggers = ['button:has-text("ZIP")', 'button:has-text("Delivery ZIP")', 'a:has-text("ZIP")', 'button:has-text("Delivery Location")', 'button:has-text("Change")', '[aria-label*="ZIP" i]'];
  for (const selector of triggers) {
    const trigger = page.locator(selector).first();
    if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await trigger.click({ timeout: 5_000 }).catch(() => undefined);
      break;
    }
  }

  const activeDrawer = page.locator('[role="dialog"]:visible, .DrawerV2:visible, [class*="DrawerV2"]:visible, [class*="drawer"]:visible').last();
  const zipScope = (await activeDrawer.isVisible({ timeout: 5_000 }).catch(() => false)) ? activeDrawer : page;
  const zipInput = zipScope.locator('input[name*="zip" i], input[id*="zip" i], input[placeholder*="zip" i], input[aria-label*="zip" i], input[type="tel"], input[type="text"]').first();
  if (!(await zipInput.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const screenshotPath = await saveStep(page, 'delivery-zip-input-not-found');
    throw new Error(`Unable to find Costco Business Center delivery ZIP input before scraping. Screenshot saved to ${screenshotPath}.`);
  }
  await zipInput.fill(deliveryZipCode);
  await saveStep(page, '02-after-entering-zip', { deliveryZipCode });

  const submitScope = (await activeDrawer.isVisible({ timeout: 1_000 }).catch(() => false)) ? activeDrawer : page;
  const exactSubmit = submitScope.getByRole('button', { name: /^Set Delivery ZIP Code$/ }).first();
  if (!(await exactSubmit.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const screenshotPath = await saveStep(page, 'set-delivery-zip-code-button-not-found', { deliveryZipCode });
    throw new Error(`Unable to find exact Costco Business Center button "Set Delivery ZIP Code" after entering ${deliveryZipCode}. Screenshot saved to ${screenshotPath}.`);
  }

  await exactSubmit.click({ timeout: 10_000 }).catch(async (error) => {
    await exactSubmit.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await exactSubmit.click({ timeout: 5_000, force: true }).catch(() => { throw error; });
  });

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  if (await activeDrawer.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await activeDrawer.waitFor({ state: 'hidden', timeout: 30_000 }).catch(async () => {
      const screenshotPath = await saveStep(page, 'delivery-drawer-did-not-close', { deliveryZipCode });
      throw new Error(`Costco Business Center delivery ZIP drawer/modal did not close after setting ${deliveryZipCode}. Screenshot saved to ${screenshotPath}.`);
    });
  }

  await page.waitForFunction((zip) => document.body.innerText.includes(zip), deliveryZipCode, { timeout: 30_000 }).catch(async () => {
    const screenshotPath = await saveStep(page, 'delivery-zip-not-visible-after-submit', { deliveryZipCode });
    throw new Error(`Costco Business Center did not show selected delivery ZIP/location ${deliveryZipCode} after the drawer closed. Screenshot saved to ${screenshotPath}.`);
  });

  return assertDeliveryZipConfirmed(page, 'set-during-run');
}

async function searchForInstantSavings(page) {
  const searchBox = page.locator('input[type="search"], input[placeholder*="search" i], input[aria-label*="search" i], form[role="search"] input').first();
  if (!(await searchBox.isVisible({ timeout: 10_000 }).catch(() => false))) throw new Error('Unable to find Costco Business Center search input for Instant Savings.');
  await searchBox.fill(dealSource.searchTerm);
  await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined), searchBox.press('Enter')]);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await failIfBlocked(page, 'instant-savings-search');

  const allOnline = page.locator('a, button').filter({ hasText: /all\s+online\s+instant\s+savings/i }).first();
  if (await allOnline.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined), allOnline.click({ timeout: 10_000 })]);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  }
  await page.waitForFunction(() => [...document.querySelectorAll('a[href]')].some((anchor) => /(?:\/p\/|\/product(?:[/?#]|$)|\.product\.\d+\.html|ProductDisplay|productId=|partNumber=)/i.test(anchor.getAttribute('href') || '')), { timeout: 15_000 }).catch(() => undefined);
  const productTileSignals = await detectProductTileSignals(page);
  const hasProducts = productTileSignals.productTileCount > 0;
  const screenshotPath = hasProducts
    ? await saveStep(page, '02-all-online-instant-savings', { hasProducts, productTileSignals })
    : await saveDomDebug(page, '02-all-online-instant-savings-no-products', { hasProducts, productTileSignals });
  if (!hasProducts) throw new Error(`All Online Instant Savings did not show product tiles. Screenshot and DOM debug saved to ${screenshotPath}.`);
  await writeFile(path.join(logDir, 'all-online-instant-savings-url.txt'), `${page.url()}\n`);
  return page.url();
}

async function loadMoreProductsIfAvailable(page) {
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const loadMore = page.locator('button:has-text("Load More"), a:has-text("Load More"), button:has-text("Show More")').first();
    if (!(await loadMore.isVisible({ timeout: 1_000 }).catch(() => false))) break;
    await loadMore.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
}

function productAllowed(product) {
  const combined = [product.category, product.productName, product.brand].filter(Boolean).join(' ');
  if (varietyPackPattern.test(combined)) return false;
  if (globalExcludedPattern.test(combined)) return false;
  if (!product.category) return true;
  return relevantCategoryPatterns.some((pattern) => pattern.test(product.category)) && !globalExcludedPattern.test(product.category);
}

function unifiedDeal(product) {
  return {
    supplier: product.supplier ?? 'Costco Business Center', dealSource: product.dealSource ?? dealSource.name, category: product.category ?? null,
    productName: product.productName ?? null, brand: product.brand ?? null, sku: product.sku ?? null, upc: product.upc ?? null,
    packageSize: product.packageSize ?? null, currentPrice: product.currentPrice ?? null, originalPrice: product.originalPrice ?? null,
    discount: product.discount ?? null, coupon: product.coupon ?? null, availability: product.availability ?? null,
    quantityLimit: product.quantityLimit ?? null, productUrl: product.productUrl ?? null, imageUrl: product.imageUrl ?? null,
    scanDate: product.scanDate ?? new Date().toISOString()
  };
}

function buildShoppingListReport(products) {
  return products.map((product) => ({
    recommendedStore: product.supplier, product: product.productName, price: product.currentPrice, dealSource: product.dealSource, url: product.productUrl,
    notes: [product.brand && `Brand: ${product.brand}`, product.sku && `SKU/item: ${product.sku}`, product.upc && `UPC: ${product.upc}`, product.packageSize && `Package: ${product.packageSize}`, product.originalPrice && `Original: ${product.originalPrice}`, product.discount && `Discount: ${product.discount}`, product.coupon && `Coupon: ${product.coupon}`, product.availability && `Availability: ${product.availability}`, product.quantityLimit && `Limit: ${product.quantityLimit}`, 'Purchase in store by 50TOC worker'].filter(Boolean).join(' | ')
  }));
}

async function saveProgress(products) {
  const unifiedProducts = products.map(unifiedDeal).filter(productAllowed);
  await writeFile(dealProductsPath, JSON.stringify(unifiedProducts, null, 2));
  await writeFile(shoppingListReportPath, JSON.stringify(buildShoppingListReport(unifiedProducts), null, 2));
}

function productTileExtractorScript({ dealSourceName, relevantSources, excludedSource, varietySource, filterAllowed = false }) {
  const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
  const absUrl = (value) => { try { return value ? new URL(value, location.href).toString() : null; } catch { return null; } };
  const relevant = relevantSources.map((source) => new RegExp(source, 'i'));
  const excluded = new RegExp(excludedSource, 'i');
  const variety = new RegExp(varietySource, 'i');
  const prices = (text) => [...text.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
  const visible = (node) => !!(node?.offsetWidth || node?.offsetHeight || node?.getClientRects().length);
  const productHrefPattern = /(?:\/p\/|\/product(?:[/?#]|$)|\.product\.\d+\.html|ProductDisplay|productId=|partNumber=)/i;
  const nonProductHrefPattern = /\/cart|\/checkout|\/account|\/orders?|\/customer-service|\/warehouse|\/sitemap|\/privacy|\/terms|\/login|\/register|\/category|\/catalogsearch|\/s\?/i;
  const itemFromHref = (href) => clean(href?.match(/\.product\.(\d+)\.html/i)?.[1] || href?.match(/[?&](?:productId|partNumber)=(\d+)/i)?.[1]);
  const categoryFrom = (card) => clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent || card.closest('[data-category]')?.getAttribute('data-category'));
  const findCard = (link) => {
    let best = link;
    for (let node = link, depth = 0; node && depth < 9; depth += 1, node = node.parentElement) {
      const text = node.textContent || '';
      const linkCount = node.querySelectorAll?.('a[href]')?.length ?? 0;
      const hasProductSignal = node.querySelector('img') && (/\$|Instant Savings|Save|Limit|Delivery|Item\s*#?/i.test(text) || itemFromHref(link.getAttribute('href')));
      if (hasProductSignal && linkCount <= 8) best = node;
      if (/^(LI|ARTICLE)$/i.test(node.tagName) && hasProductSignal) return node;
    }
    return best.closest('li, article, [data-testid*="product" i], [class*="product" i], [data-testid*="item" i], div') || best;
  };
  const nameFrom = (card, link, image) => clean(
    link.getAttribute('aria-label') ||
    link.getAttribute('title') ||
    link.querySelector('[aria-label]')?.getAttribute('aria-label') ||
    link.querySelector('img')?.getAttribute('alt') ||
    card.querySelector('[data-testid*="name" i], [data-testid*="description" i], [class*="description" i], [class*="name" i], [id*="description" i], [id*="title" i], h2, h3, h4')?.textContent ||
    link.textContent ||
    image?.getAttribute('alt')
  );
  const links = [...document.querySelectorAll('a[href]')].filter((link) => {
    const href = link.getAttribute('href') || '';
    return visible(link) && productHrefPattern.test(href) && !nonProductHrefPattern.test(href);
  });
  const seen = new Set();
  return links.map((link) => {
    const productUrl = absUrl(link.getAttribute('href'));
    if (!productUrl || seen.has(productUrl)) return null;
    const card = findCard(link);
    const text = clean(card.textContent) || '';
    const image = card.querySelector('img[alt], img') || link.querySelector('img[alt], img');
    const productName = nameFrom(card, link, image);
    const sku = clean(text.match(/(?:Item\s*#?|SKU)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]) || itemFromHref(productUrl);
    const hasVisibleName = !!(productName && productName.length >= 3 && !/^view details?$/i.test(productName));
    const hasStableProductSignals = !!(productUrl && (sku || hasVisibleName));
    if (!hasStableProductSignals) return null;
    seen.add(productUrl);
    const category = categoryFrom(card);
    const combined = [category, productName, text].filter(Boolean).join(' ');
    if (filterAllowed && (variety.test(combined) || excluded.test(combined))) return null;
    if (filterAllowed && category && !relevant.some((pattern) => pattern.test(category))) return null;
    const priceList = prices(text);
    return { supplier: 'Costco Business Center', dealSource: dealSourceName, category, productName, brand: null, sku, upc: null, packageSize: clean(text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]), currentPrice: priceList[0] ?? null, originalPrice: priceList[1] ?? null, discount: clean(text.match(/(?:instant\s+savings|save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off)/i)?.[0]), coupon: clean(text.match(/(?:instant savings|coupon|clip|save \$?\d+)[^.]{0,120}/i)?.[0]), availability: clean(text.match(/(?:in stock|out of stock|available|delivery)[^.]{0,80}/i)?.[0]), quantityLimit: clean(text.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]), productUrl, imageUrl: absUrl(image?.currentSrc || image?.getAttribute('src')), scanDate: new Date().toISOString() };
  }).filter(Boolean);
}

async function detectProductTileSignals(page) {
  return page.evaluate(productTileExtractorScript, { dealSourceName: dealSource.name, relevantSources: relevantCategoryPatterns.map((p) => p.source), excludedSource: globalExcludedPattern.source, varietySource: varietyPackPattern.source, filterAllowed: false }).then((products) => ({ productTileCount: products.length, sampleProducts: products.slice(0, 10) }));
}

async function extractListingProducts(page) {
  await loadMoreProductsIfAvailable(page);
  for (let i = 0; i < 2; i += 1) { await page.mouse.wheel(0, 1800).catch(() => undefined); await page.waitForTimeout(750); }
  return page.evaluate(productTileExtractorScript, { dealSourceName: dealSource.name, relevantSources: relevantCategoryPatterns.map((p) => p.source), excludedSource: globalExcludedPattern.source, varietySource: varietyPackPattern.source, filterAllowed: false });
}

async function enrichProductFromPage(page, listingProduct, index) {
  await gotoAndCheck(page, listingProduct.productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }, `product-${index + 1}`);
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const screenshotPath = await saveStep(page, `03-instant-savings-product-${String(index + 1).padStart(2, '0')}`);
  const details = await page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const bodyText = clean(document.body.innerText) || '';
    const image = document.querySelector('img[alt], img');
    const prices = [...bodyText.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)].map((match) => match[0].replace(/\s+/g, ''));
    const jsonProducts = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => { try { return [JSON.parse(node.textContent || 'null')].flat(Infinity); } catch { return []; } }).filter((entry) => /Product/i.test(String(entry?.['@type'] ?? '')));
    const productJson = jsonProducts[0] ?? {};
    const offer = Array.isArray(productJson.offers) ? productJson.offers[0] : productJson.offers;
    const absUrl = (value) => { try { return value ? new URL(value, location.href).toString() : null; } catch { return null; } };
    return { productName: clean(productJson.name) || clean(document.querySelector('h1, [data-testid*="product-name" i]')?.textContent), brand: clean(typeof productJson.brand === 'string' ? productJson.brand : productJson.brand?.name), sku: clean(productJson.sku) || clean(bodyText.match(/(?:Item|Item #|SKU)\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1]), upc: clean(productJson.gtin12 || productJson.gtin13 || productJson.gtin14 || productJson.gtin) || clean(bodyText.match(/(?:UPC|GTIN)\s*[:#-]?\s*([0-9-]{8,14})/i)?.[1]), category: clean(document.querySelector('[aria-label*="breadcrumb" i], nav[aria-label*="breadcrumb" i]')?.textContent), packageSize: clean(bodyText.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0]), currentPrice: offer?.price ? String(offer.price) : prices[0] ?? null, originalPrice: prices[1] ?? null, discount: clean(bodyText.match(/(?:instant\s+savings|save\s*\$?\d+(?:\.\d{2})?|\d+%\s*off)/i)?.[0]), coupon: clean(bodyText.match(/(?:instant savings|coupon|clip|save \$?\d+)[^.]{0,120}/i)?.[0]), availability: clean(offer?.availability) || clean(bodyText.match(/(?:in stock|out of stock|available|delivery)[^.]{0,100}/i)?.[0]), quantityLimit: clean(bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0]), productUrl: location.href, imageUrl: absUrl(Array.isArray(productJson.image) ? productJson.image[0] : productJson.image) || absUrl(image?.currentSrc || image?.getAttribute('src')), scanDate: new Date().toISOString() };
  });
  return unifiedDeal({ ...listingProduct, ...Object.fromEntries(Object.entries(details).filter(([, value]) => value)), screenshotPath });
}

test.describe('Costco Business Center store shopping list intelligence', () => {
  test('scrapes All Online Instant Savings data only, without cart or checkout actions', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));
    const delivery = await ensureDeliveryZipCode(page);
    const discoveredUrl = await searchForInstantSavings(page);
    const listingScreenshots = [];
    for (let i = 0; i < maxListingScreenshots; i += 1) { listingScreenshots.push(await saveStep(page, `02-instant-savings-listing-page-${i + 1}`)); await page.mouse.wheel(0, 1400).catch(() => undefined); await page.waitForTimeout(750); }
    const listingProducts = await extractListingProducts(page);
    console.log(`Costco Business Center ${dealSource.name}: detected ${listingProducts.length} visible product tiles before opening product pages.`);
    if (listingProducts.length === 0) {
      const visualProductSignals = await page.evaluate(() => ({
        visibleImages: [...document.querySelectorAll('img')].filter((node) => !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length)).slice(0, 100).map((node) => ({ alt: node.getAttribute('alt'), src: node.currentSrc || node.getAttribute('src') })),
        priceTextMatchCount: (document.body.innerText.match(/\$\s*\d+(?:,\d{3})*(?:\.\d{2})?/g) || []).length,
        itemTextMatchCount: (document.body.innerText.match(/(?:Item\s*#?|SKU)\s*[:#-]?\s*[A-Z0-9-]{3,}/gi) || []).length
      })).catch(() => ({}));
      const screenshotPath = await saveDomDebug(page, 'instant-savings-no-scrapable-products', { detectedProductTileCount: listingProducts.length, visualProductSignals });
      throw new Error(`Costco Business Center All Online Instant Savings had no detected visible product tiles. Screenshot and DOM debug saved to ${screenshotPath}.`);
    }
    const products = [];
    for (const [index, product] of listingProducts.slice(0, maxProducts).entries()) {
      const enrichedProduct = await enrichProductFromPage(page, product, index);
      if (productAllowed(enrichedProduct)) { products.push(enrichedProduct); await saveProgress(products); }
      else console.log(`Costco Business Center: skipped excluded product/category ${enrichedProduct.productName ?? enrichedProduct.productUrl}.`);
    }
    await saveProgress(products);
    await writeFile(path.join(logDir, 'deal-execution-report.json'), JSON.stringify({ delivery, sourceReports: [{ dealSource: dealSource.name, discoveredUrl, productCount: products.length, scrapedProductLimit: maxProducts, skippedByLimitCount: Math.max(listingProducts.length - maxProducts, 0), listingScreenshots }], productCount: products.length, productLimits: { [dealSource.name]: maxProducts }, outputs: { dealProducts: dealProductsPath, shoppingListReport: shoppingListReportPath }, businessRules: { storeShoppingListOnly: true, purchasesMadePhysicallyInStoreBy50TocWorker: true, costcoBusinessCenterOnly: true, deliveryZipCode, instantSavingsOnly: true, didNotAddToCart: true, didNotCheckout: true, didNotPlaceOrder: true }, exclusions: { globalExcludedPattern: globalExcludedPattern.source, varietyPackPattern: varietyPackPattern.source }, screenshotsDirectory: screenshotDir, logsDirectory: logDir, consoleMessages, completedAt: new Date().toISOString() }, null, 2));
  });
});
