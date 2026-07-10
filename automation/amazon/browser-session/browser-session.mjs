import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const amazonHomeUrl = 'https://www.amazon.com/';
export const revsellerHomeUrl = 'https://www.revseller.com/';
export const revsellerUnavailableMessage = 'RevSeller extension is not available in the configured Chrome profile.';

let sharedContextPromise = null;

export function resolveChromePath(chromePath = process.env.AMAZON_CHROME_PATH) {
  if (!chromePath) throw new Error('AMAZON_CHROME_PATH must point to regular Google Chrome.');
  const resolvedChromePath = path.resolve(chromePath);
  if (!existsSync(resolvedChromePath)) throw new Error(`AMAZON_CHROME_PATH does not exist: ${resolvedChromePath}`);
  return resolvedChromePath;
}

export function resolveUserDataDir(userDataDir = process.env.AMAZON_CHROME_USER_DATA_DIR) {
  if (!userDataDir) throw new Error('AMAZON_CHROME_USER_DATA_DIR must point to the existing Chrome User Data directory that contains the RevSeller profile.');
  const resolvedUserDataDir = path.resolve(userDataDir);
  if (!existsSync(resolvedUserDataDir)) throw new Error(`AMAZON_CHROME_USER_DATA_DIR does not exist: ${resolvedUserDataDir}`);
  return resolvedUserDataDir;
}

export function resolveProfileDirectory(profileDirectory = process.env.AMAZON_CHROME_PROFILE_DIRECTORY) {
  if (!profileDirectory) throw new Error('AMAZON_CHROME_PROFILE_DIRECTORY must name the existing Chrome profile directory, for example Default or Profile 1.');
  if (path.isAbsolute(profileDirectory) || profileDirectory.includes('/') || profileDirectory.includes('\\')) {
    throw new Error('AMAZON_CHROME_PROFILE_DIRECTORY must be a Chrome profile directory name such as Default or Profile 1, not a full path.');
  }
  return profileDirectory;
}

export function resolveChromeProfileConfig({ chromePath, userDataDir, profileDirectory } = {}) {
  const resolvedUserDataDir = resolveUserDataDir(userDataDir);
  const resolvedProfileDirectory = resolveProfileDirectory(profileDirectory);
  const resolvedProfilePath = path.join(resolvedUserDataDir, resolvedProfileDirectory);
  if (!existsSync(resolvedProfilePath)) throw new Error(`Configured Chrome profile directory does not exist: ${resolvedProfilePath}`);
  return {
    chromePath: resolveChromePath(chromePath),
    userDataDir: resolvedUserDataDir,
    profileDirectory: resolvedProfileDirectory,
    profilePath: resolvedProfilePath
  };
}

function profileDirectoryArg(profileDirectory) {
  return `--profile-directory=${profileDirectory}`;
}

export function buildLaunchOptions({
  chromePath = process.env.AMAZON_CHROME_PATH,
  profileDirectory = process.env.AMAZON_CHROME_PROFILE_DIRECTORY,
  headless = process.env.AMAZON_BROWSER_HEADLESS === 'true',
  viewport = { width: 1440, height: 1000 },
  args = []
} = {}) {
  const resolvedProfileDirectory = resolveProfileDirectory(profileDirectory);
  return {
    executablePath: resolveChromePath(chromePath),
    headless,
    viewport,
    args: [...new Set(['--disable-dev-shm-usage', '--no-sandbox', profileDirectoryArg(resolvedProfileDirectory), ...args])]
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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function manifestMatchesRevseller(manifest) {
  const text = [manifest?.name, manifest?.short_name, manifest?.description]
    .filter(Boolean)
    .join(' ');
  return /revseller/i.test(text);
}

export async function findRevsellerExtension(profilePath) {
  const preferences = await readJsonIfExists(path.join(profilePath, 'Preferences'));
  const settings = preferences?.extensions?.settings ?? {};
  for (const [extensionId, setting] of Object.entries(settings)) {
    if (setting?.state === 0) continue;
    if (manifestMatchesRevseller(setting?.manifest)) {
      return { extensionId, source: 'Preferences' };
    }
  }
  return null;
}

export async function verifyRevsellerExtensionAvailable(profilePath) {
  const extension = await findRevsellerExtension(profilePath);
  if (!extension) throw new Error(revsellerUnavailableMessage);
  return extension;
}

export async function launchAmazonBrowserSession({ chromium, chromePath, userDataDir, profileDirectory, launchOptions } = {}) {
  const config = resolveChromeProfileConfig({ chromePath, userDataDir, profileDirectory });
  const revsellerExtension = await verifyRevsellerExtensionAvailable(config.profilePath);
  const chromiumLauncher = await loadChromium(chromium);
  const context = await chromiumLauncher.launchPersistentContext(config.userDataDir, buildLaunchOptions({ chromePath: config.chromePath, profileDirectory: config.profileDirectory, ...launchOptions }));
  context.amazonBrowserSession = {
    chromePath: config.chromePath,
    userDataDir: config.userDataDir,
    profileDirectory: config.profileDirectory,
    profilePath: config.profilePath,
    revsellerExtension,
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
