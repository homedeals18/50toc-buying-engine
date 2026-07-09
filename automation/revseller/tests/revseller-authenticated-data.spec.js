import { chromium, expect, test as base } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getRevsellerCredentials, revsellerConnectorConfig as config } from '../connector-config.mjs';
import { amazonAnalysisReportPath, extractRevsellerFields, openConfidentAmazonMatch, readConnectorProductsFromJsonFile, readRevsellerPanel, writeRevsellerAnalysisReport } from '../revseller-integration.mjs';

const artifactRoot = path.resolve(process.cwd(), '../../artifacts/revseller');
const logDir = path.join(artifactRoot, 'logs');
const profileDir = path.join(artifactRoot, 'profile');
const authReportPath = path.join(logDir, 'auth-report.json');

async function ensureArtifactDirs() {
  await Promise.all([mkdir(logDir, { recursive: true }), mkdir(profileDir, { recursive: true })]);
}

async function writeSafeJson(filePath, data) {
  await ensureArtifactDirs();
  await writeRevsellerAnalysisReport(filePath, data);
}

const test = base.extend({
  context: async ({}, use) => {
    await ensureArtifactDirs();
    const context = await chromium.launchPersistentContext(profileDir, {
      baseURL: config.baseUrl,
      headless: false,
      viewport: { width: 1440, height: 1000 },
      args: ['--disable-dev-shm-usage', '--no-sandbox']
    });
    try { await use(context); } finally { await context.close(); }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? await context.newPage();
    await use(page);
  }
});

async function isAuthenticated(page) {
  await page.goto(config.accountUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  const currentUrl = page.url();
  const hasPasswordField = await page.locator('input[type="password"]').first().isVisible({ timeout: 2_000 }).catch(() => false);
  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  return !/\/login/i.test(currentUrl) && !hasPasswordField && !/sign\s*in|login/i.test(bodyText.slice(0, 500));
}

async function loginWithEnvironmentCredentials(page) {
  const credentials = getRevsellerCredentials();
  if (!credentials.hasCredentials) return { attempted: false, reason: 'REVSELLER_EMAIL and REVSELLER_PASSWORD are not both set in .env' };

  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.locator('input[type="email"], input[name*="email" i]').first().fill(credentials.email);
  await page.locator('input[type="password"], input[name*="password" i]').first().fill(credentials.password);
  const keepLoggedIn = page.locator('input[type="checkbox"]').first();
  if (await keepLoggedIn.isVisible({ timeout: 1_000 }).catch(() => false)) await keepLoggedIn.check().catch(() => undefined);
  await Promise.all([
    page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined),
    page.locator('button[type="submit"], input[type="submit"], button:has-text("Sign In")').first().click()
  ]);
  return { attempted: true, authenticated: await isAuthenticated(page) };
}

async function promptForManualLogin(page) {
  console.log('RevSeller authentication required. Complete login in the opened browser window once; the persistent profile will be reused on future runs. Credentials will not be logged or saved by the automation.');
  await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect.poll(async () => isAuthenticated(page), { timeout: config.manualLoginTimeoutMs, message: 'Waiting for operator to complete RevSeller login' }).toBe(true);
  return { prompted: true, authenticated: true };
}

async function ensureAuthenticated(page) {
  if (await isAuthenticated(page)) return { status: 'authenticated', reusedSession: true, loginAttempt: null, manualLogin: null };
  const loginAttempt = await loginWithEnvironmentCredentials(page);
  if (loginAttempt.authenticated || await isAuthenticated(page)) return { status: 'authenticated', reusedSession: false, loginAttempt, manualLogin: null };
  const manualLogin = await promptForManualLogin(page);
  return { status: 'authenticated', reusedSession: false, loginAttempt, manualLogin };
}

async function connectorProducts() {
  const fileProducts = await readConnectorProductsFromJsonFile(config.connectorProductsPath);
  const urlProducts = config.amazonProductUrls.map((amazonUrl) => ({ amazonUrl }));
  return [...fileProducts, ...urlProducts].slice(0, config.maxProducts);
}

async function analyzeProduct(page, connectorProduct) {
  const amazonMatch = await openConfidentAmazonMatch(page, connectorProduct);
  if (!amazonMatch.revsellerEligible) {
    return {
      connectorProduct,
      amazonMatchStatus: amazonMatch.status,
      needsReview: true,
      confidenceScore: amazonMatch.match.confidenceScore,
      matchReason: amazonMatch.match.matchReason,
      revsellerPanelRead: false,
      analyzedAt: new Date().toISOString()
    };
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  const panel = await readRevsellerPanel(page);
  return {
    connectorProduct,
    amazonMatchStatus: amazonMatch.status,
    needsReview: false,
    confidenceScore: amazonMatch.match.confidenceScore,
    matchReason: amazonMatch.match.matchReason,
    amazonAsin: amazonMatch.match.amazonAsin,
    amazonTitle: amazonMatch.match.amazonTitle,
    revsellerPanelRead: true,
    ...extractRevsellerFields(panel),
    analyzedAt: new Date().toISOString()
  };
}

test.describe('RevSeller authenticated integration', () => {
  test('authenticates before reading RevSeller data and reuses the browser session', async ({ page }) => {
    const auth = await ensureAuthenticated(page);
    await writeSafeJson(authReportPath, { connector: config.supplier, status: auth.status, reusedSession: auth.reusedSession, loginAttemptedWithEnvironmentCredentials: Boolean(auth.loginAttempt?.attempted), manualLoginPrompted: Boolean(auth.manualLogin?.prompted), completedAt: new Date().toISOString() });

    const productsToAnalyze = await connectorProducts();
    if (productsToAnalyze.length === 0) {
      await writeSafeJson(amazonAnalysisReportPath, { connector: config.supplier, status: 'authenticated-no-products-configured', products: [], message: 'Set REVSELLER_CONNECTOR_PRODUCTS_PATH or REVSELLER_AMAZON_PRODUCT_URLS to collect RevSeller data from Amazon product pages.', completedAt: new Date().toISOString() });
      return;
    }

    const products = [];
    for (const connectorProduct of productsToAnalyze) products.push(await analyzeProduct(page, connectorProduct));
    await writeSafeJson(amazonAnalysisReportPath, { connector: config.supplier, authenticated: true, profitabilitySource: 'RevSeller', productCount: products.length, products, completedAt: new Date().toISOString() });
  });
});
