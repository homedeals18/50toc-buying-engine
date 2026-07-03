import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/bjs');
const screenshotDir = path.join(artifactRoot, 'screenshots');
const logDir = path.join(artifactRoot, 'logs');
const storageDir = path.join(artifactRoot, 'storage');
const authStatePath = path.join(storageDir, 'bjs-auth-state.json');
const searchTerm = 'Blue Diamond Almonds 0.75 oz';
const manualLoginTimeout = Number(process.env.BJS_MANUAL_LOGIN_TIMEOUT_MS ?? 10 * 60_000);

async function ensureArtifactDirs() {
  await Promise.all([
    mkdir(screenshotDir, { recursive: true }),
    mkdir(logDir, { recursive: true }),
    mkdir(storageDir, { recursive: true })
  ]);
}

async function saveStep(page, name, details = {}) {
  await ensureArtifactDirs();
  const safeName = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const screenshotPath = path.join(screenshotDir, `${safeName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(
    path.join(logDir, `${safeName}.json`),
    JSON.stringify({ ...details, url: page.url(), title: await page.title(), savedAt: new Date().toISOString(), screenshotPath }, null, 2)
  );
  return screenshotPath;
}

async function visibleText(page, selector, timeout = 1_500) {
  const locator = page.locator(selector).first();
  if (!(await locator.isVisible({ timeout }).catch(() => false))) return null;
  return (await locator.innerText().catch(() => null))?.replace(/\s+/g, ' ').trim() || null;
}

async function textNearLabel(page, labelPattern) {
  return page.evaluate((source) => {
    const pattern = new RegExp(source, 'i');
    const text = document.body.innerText.replace(/\s+/g, ' ');
    const match = text.match(new RegExp(`(?:${source})\\s*[:#-]?\\s*([A-Z0-9-]{4,})`, 'i'));
    if (match) return match[1];
    const nodes = [...document.querySelectorAll('body *')].filter((node) => pattern.test(node.textContent || ''));
    for (const node of nodes) {
      const combined = [node.textContent, node.nextElementSibling?.textContent, node.parentElement?.textContent]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ');
      const nearby = combined.match(new RegExp(`(?:${source})\\s*[:#-]?\\s*([A-Z0-9-]{4,})`, 'i'));
      if (nearby) return nearby[1];
    }
    return null;
  }, labelPattern.source ?? String(labelPattern));
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
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await clickCookieOrModalDismissers(page);
  await saveStep(page, '01-bjs-homepage-before-auth-check');

  if (await isAuthenticated(page)) {
    await page.context().storageState({ path: authStatePath });
    return { authenticated: true, authStatePath, loginMode: 'reused-existing-session' };
  }

  const signIn = page.locator('a:has-text("Sign In"), button:has-text("Sign In"), text=/sign\\s*in|log\\s*in/i').first();
  if (await signIn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await signIn.click({ timeout: 5_000 }).catch(() => undefined);
  }

  await saveStep(page, '02-bjs-login-required');
  console.log(`BJ's login is required. Complete login in the opened browser. The test will wait up to ${manualLoginTimeout} ms, then save ${authStatePath}.`);
  await page.waitForFunction(() => /sign\s*out|log\s*out|my\s+account|membership|account/i.test(document.body.innerText), null, { timeout: manualLoginTimeout });
  await page.context().storageState({ path: authStatePath });
  await saveStep(page, '03-bjs-login-complete');
  return { authenticated: true, authStatePath, loginMode: 'manual-login-saved' };
}

async function searchForProduct(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await clickCookieOrModalDismissers(page);
  const searchBox = page.locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i], input[name*="search" i]').first();
  if (await searchBox.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await searchBox.fill(searchTerm);
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => undefined), searchBox.press('Enter')]);
  } else {
    await page.goto(`/search/${encodeURIComponent(searchTerm)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await saveStep(page, '04-blue-diamond-almonds-results', { searchTerm });
}

async function openFirstMatchingProduct(page) {
  const productLink = page.locator('a', { hasText: /blue\s+diamond|almonds/i }).filter({ hasText: /almond/i }).first();
  if (await productLink.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => undefined), productLink.click()]);
  } else {
    const fallback = page.locator('[data-testid*="product" i] a, .product a, a[href*="/product"], a[href*="/p/"]').first();
    await expect(fallback, 'Expected at least one search result product link').toBeVisible({ timeout: 15_000 });
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => undefined), fallback.click()]);
  }
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await saveStep(page, '05-first-matching-product-opened');
}

async function extractProductDetails(page) {
  const bodyText = (await page.locator('body').innerText({ timeout: 15_000 })).replace(/\s+/g, ' ').trim();
  const jsonLd = await page.locator('script[type="application/ld+json"]').evaluateAll((nodes) => nodes.map((node) => node.textContent).filter(Boolean)).catch(() => []);
  const productJson = jsonLd.flatMap((text) => {
    try { return [JSON.parse(text)]; } catch { return []; }
  }).flat(Infinity).find((entry) => /Product/i.test(String(entry?.['@type'] ?? '')));
  return {
    name: productJson?.name || await visibleText(page, 'h1, [data-testid*="product-name" i]'),
    sku: productJson?.sku || await textNearLabel(page, /SKU|Item/),
    upc: productJson?.gtin12 || productJson?.gtin13 || productJson?.gtin || await textNearLabel(page, /UPC|GTIN/),
    price: productJson?.offers?.price || await visibleText(page, '[data-testid*="price" i], [class*="price" i]'),
    availability: productJson?.offers?.availability || await visibleText(page, 'text=/in stock|out of stock|available|pickup|delivery/i'),
    quantityLimits: bodyText.match(/(?:limit|maximum|max)\s*(?:of)?\s*\d+[^.]{0,80}/i)?.[0] ?? null,
    coupons: bodyText.match(/(?:coupon|clip|instant savings|save \$?\d+)[^.]{0,120}/i)?.[0] ?? null,
    packageSize: bodyText.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|ct|count|pack|lb|lbs)\b(?:\s*[xX]\s*\d+)?/i)?.[0] ?? null,
    url: page.url()
  };
}

async function addOneToCart(page) {
  const addButton = page.locator('button:has-text("Add to Cart"), button:has-text("Add"), [aria-label*="Add to Cart" i]').first();
  await expect(addButton, 'Expected an Add to Cart button on the product page').toBeVisible({ timeout: 20_000 });
  await addButton.click();
  await page.waitForTimeout(2_000);
  await saveStep(page, '06-item-added-to-cart');
}

async function verifyCartContainsItem(page, productName) {
  const cartLink = page.locator('a[href*="cart"], button[aria-label*="cart" i], text=/cart/i').first();
  if (await cartLink.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => undefined), cartLink.click()]);
  } else {
    await page.goto('/cart', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await saveStep(page, '07-cart-before-checkout-stop');
  const body = await page.locator('body').innerText({ timeout: 15_000 });
  const firstProductWord = productName?.split(/\s+/).find((word) => word.length > 3) ?? 'Almond';
  expect(body, 'Expected cart to contain the added BJ\'s item before checkout').toMatch(new RegExp(firstProductWord, 'i'));
}

test.describe("BJ's product cart automation", () => {
  test('searches, extracts product data, adds one item to cart, and stops before checkout', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (message) => consoleMessages.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => consoleMessages.push({ type: 'pageerror', text: error.message }));

    const auth = await ensureAuthenticated(page);
    await searchForProduct(page);
    await openFirstMatchingProduct(page);
    const product = await extractProductDetails(page);
    await writeFile(path.join(logDir, 'product-details.json'), JSON.stringify(product, null, 2));

    expect(product.name, 'Expected product name to be extracted').toBeTruthy();
    expect(`${product.name} ${product.packageSize ?? ''}`, 'Expected first product to match Blue Diamond Almonds 0.75 oz').toMatch(/blue\s+diamond|almond|0\.75\s*oz/i);

    await addOneToCart(page);
    await verifyCartContainsItem(page, product.name);

    const report = {
      searchTerm,
      auth,
      product,
      stoppedBeforeCheckout: true,
      didNotPlaceOrder: true,
      screenshotsDirectory: screenshotDir,
      logsDirectory: logDir,
      consoleMessages,
      completedAt: new Date().toISOString()
    };
    await writeFile(path.join(logDir, 'execution-report.json'), JSON.stringify(report, null, 2));
  });
});
