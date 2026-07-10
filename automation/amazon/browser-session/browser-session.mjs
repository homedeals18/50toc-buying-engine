import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const amazonHomeUrl = 'https://www.amazon.com/';
export const revsellerHomeUrl = 'https://www.revseller.com/';
export const revsellerUnavailableMessage = 'RevSeller extension is not available in the configured Chrome profile.';
export const chromeProfileInUseMessage = 'Configured Chrome profile is already in use. Start that existing Chrome session with --remote-debugging-port=9222 and set AMAZON_CHROME_CDP_ENDPOINT, or close Chrome before running Amazon analysis. The automation will not create a second conflicting Chrome instance or a temporary profile.';
export const defaultAmazonChromeCdpEndpoint = 'http://127.0.0.1:9222';

const defaultWindowsChromeConfig = {
  chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: 'C:\\Users\\Nir\\AppData\\Local\\Google\\Chrome\\User Data',
  profileDirectory: 'Default'
};

let sharedContextPromise = null;

export function resolveChromePath(chromePath = process.env.AMAZON_CHROME_PATH ?? (process.platform === 'win32' ? defaultWindowsChromeConfig.chromePath : undefined)) {
  if (!chromePath) throw new Error('AMAZON_CHROME_PATH must point to regular Google Chrome.');
  const resolvedChromePath = path.resolve(chromePath);
  if (!existsSync(resolvedChromePath)) throw new Error(`AMAZON_CHROME_PATH does not exist: ${resolvedChromePath}`);
  return resolvedChromePath;
}

export function resolveUserDataDir(userDataDir = process.env.AMAZON_CHROME_USER_DATA_DIR ?? (process.platform === 'win32' ? defaultWindowsChromeConfig.userDataDir : undefined)) {
  if (!userDataDir) throw new Error('AMAZON_CHROME_USER_DATA_DIR must point to the existing Chrome User Data directory that contains the RevSeller profile.');
  const resolvedUserDataDir = path.resolve(userDataDir);
  if (!existsSync(resolvedUserDataDir)) throw new Error(`AMAZON_CHROME_USER_DATA_DIR does not exist: ${resolvedUserDataDir}`);
  return resolvedUserDataDir;
}

export function resolveProfileDirectory(profileDirectory = process.env.AMAZON_CHROME_PROFILE_DIRECTORY ?? (process.platform === 'win32' ? defaultWindowsChromeConfig.profileDirectory : undefined)) {
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
  chromePath = process.env.AMAZON_CHROME_PATH ?? (process.platform === 'win32' ? defaultWindowsChromeConfig.chromePath : undefined),
  profileDirectory = process.env.AMAZON_CHROME_PROFILE_DIRECTORY ?? (process.platform === 'win32' ? defaultWindowsChromeConfig.profileDirectory : undefined),
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


function chromeProfileLockPaths(userDataDir) {
  return ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].map((name) => path.join(userDataDir, name));
}

export function isChromeProfileInUse(userDataDir) {
  return chromeProfileLockPaths(userDataDir).some((lockPath) => existsSync(lockPath));
}

async function connectToExistingChromeSession({ chromiumLauncher, cdpEndpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT ?? defaultAmazonChromeCdpEndpoint, config, revsellerExtension }) {
  try {
    const browser = await chromiumLauncher.connectOverCDP(cdpEndpoint);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close().catch(() => {});
      throw new Error('Connected Chrome session has no browser contexts.');
    }
    context.amazonBrowserSession = {
      chromePath: config.chromePath,
      userDataDir: config.userDataDir,
      profileDirectory: config.profileDirectory,
      profilePath: config.profilePath,
      revsellerExtension,
      persistent: true,
      autoLogin: false,
      connectedOverCDP: true,
      cdpEndpoint,
      sharedFor: ['amazon-product-discovery', 'amazon-matching', 'revseller']
    };
    return context;
  } catch (error) {
    throw new Error(`${chromeProfileInUseMessage} Failed to connect to ${cdpEndpoint}: ${error.message}`);
  }
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
  if (isChromeProfileInUse(config.userDataDir)) {
    return connectToExistingChromeSession({ chromiumLauncher, config, revsellerExtension });
  }
  let context;
  try {
    context = await chromiumLauncher.launchPersistentContext(config.userDataDir, buildLaunchOptions({ chromePath: config.chromePath, profileDirectory: config.profileDirectory, ...launchOptions }));
  } catch (error) {
    if (/profile|user data|process|singleton|lock/i.test(error.message)) {
      throw new Error(`${chromeProfileInUseMessage} Original launch error: ${error.message}`);
    }
    throw error;
  }
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
