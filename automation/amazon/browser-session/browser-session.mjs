import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const defaultProfileDir = path.join(repositoryRoot, 'artifacts', 'amazon', 'browser-session', 'chromium-profile');
export const amazonHomeUrl = 'https://www.amazon.com/';
export const revsellerHomeUrl = 'https://www.revseller.com/';

let sharedContextPromise = null;

export function resolveProfileDir(profileDir = process.env.AMAZON_BROWSER_PROFILE_DIR) {
  return path.resolve(profileDir || defaultProfileDir);
}

export function buildLaunchOptions({
  headless = process.env.AMAZON_BROWSER_HEADLESS === 'true',
  viewport = { width: 1440, height: 1000 },
  args = []
} = {}) {
  return {
    headless,
    viewport,
    args: [...new Set(['--disable-dev-shm-usage', '--no-sandbox', ...args])]
  };
}

async function loadChromium(chromium) {
  if (chromium) return chromium;
  try {
    return (await import('playwright')).chromium;
  } catch (error) {
    throw new Error(`Playwright is required to launch the Amazon browser session. Install playwright or pass a chromium launcher. ${error.message}`);
  }
}

export async function launchAmazonBrowserSession({ chromium, profileDir, launchOptions } = {}) {
  const resolvedProfileDir = resolveProfileDir(profileDir);
  await mkdir(resolvedProfileDir, { recursive: true });
  const chromiumLauncher = await loadChromium(chromium);
  const context = await chromiumLauncher.launchPersistentContext(resolvedProfileDir, buildLaunchOptions(launchOptions));
  context.amazonBrowserSession = {
    profileDir: resolvedProfileDir,
    persistent: true,
    autoLogin: false,
    sharedFor: ['amazon-product-discovery', 'amazon-matching', 'revseller']
  };
  return context;
}

export async function getAmazonBrowserSession(options = {}) {
  if (!sharedContextPromise) {
    sharedContextPromise = launchAmazonBrowserSession(options).catch((error) => {
      sharedContextPromise = null;
      throw error;
    });
  }
  return sharedContextPromise;
}

export async function closeAmazonBrowserSession() {
  if (!sharedContextPromise) return;
  const context = await sharedContextPromise;
  sharedContextPromise = null;
  await context.close();
}

export async function getAmazonBrowserPage(options = {}) {
  const context = await getAmazonBrowserSession(options);
  return context.pages()[0] ?? context.newPage();
}

export async function probeLoginSessions(page) {
  const results = { amazon: { checked: false, loggedIn: false }, revseller: { checked: false, loggedIn: false } };

  await page.goto(amazonHomeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const amazonText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  results.amazon = {
    checked: true,
    loggedIn: /\baccount\s*&\s*lists\b/i.test(amazonText) && !/\bsign\s*in\b/i.test(amazonText.slice(0, 1500)),
    url: page.url()
  };

  await page.goto(revsellerHomeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const revsellerHasPassword = await page.locator('input[type="password"]').first().isVisible({ timeout: 2_000 }).catch(() => false);
  const revsellerText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
  results.revseller = {
    checked: true,
    loggedIn: !revsellerHasPassword && !/\b(sign\s*in|login)\b/i.test(revsellerText.slice(0, 1000)),
    url: page.url()
  };

  return results;
}
