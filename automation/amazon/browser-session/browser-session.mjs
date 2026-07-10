import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const amazonHomeUrl = 'https://www.amazon.com/';
export const revsellerHomeUrl = 'https://www.revseller.com/';
export const revsellerUnavailableMessage = 'RevSeller extension is not available in the configured Chrome profile.';
export const chromeProfileInUseMessage = 'Configured Chrome profile is already in use. Start that existing Chrome session with --remote-debugging-port=9222 and set AMAZON_CHROME_CDP_ENDPOINT, or close Chrome before running Amazon analysis. The automation will not create a second conflicting Chrome instance or a temporary profile.';
export const defaultAmazonChromeCdpEndpoint = 'http://127.0.0.1:9222';
export const revsellerVerificationAmazonProductUrl = process.env.REVSELLER_VERIFICATION_AMAZON_PRODUCT_URL ?? 'https://www.amazon.com/dp/B00000JY1X';

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

async function connectToExistingChromeSession({ chromiumLauncher, cdpEndpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT ?? defaultAmazonChromeCdpEndpoint, config, revsellerExtension, liveVerificationOptions }) {
  try {
    const browser = await chromiumLauncher.connectOverCDP(cdpEndpoint);
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close().catch(() => {});
      throw new Error('Connected Chrome session has no browser contexts.');
    }
    if (!revsellerExtension) {
      const liveVerification = await verifyRevsellerPresenceFromLiveAmazonPage(context, liveVerificationOptions);
      if (!liveVerification.present) {
        await context.close().catch(() => {});
        throw new Error(revsellerUnavailableMessage);
      }
      revsellerExtension = { extensionId: null, name: 'RevSeller', source: liveVerification.source, liveVerification };
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
    if (error.message === revsellerUnavailableMessage) throw error;
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

async function listDirectoriesIfExists(directoryPath) {
  try {
    return (await readdir(directoryPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readLocalizedManifestValue(extensionRoot, manifest, value) {
  const messageKey = String(value ?? '').match(/^__MSG_(.+)__$/i)?.[1];
  if (!messageKey) return value ?? null;
  const defaultLocale = manifest?.default_locale;
  if (!defaultLocale) return value;
  const messages = await readJsonIfExists(path.join(extensionRoot, '_locales', defaultLocale, 'messages.json'));
  return messages?.[messageKey]?.message ?? value;
}

async function manifestSearchText(extensionRoot, manifest) {
  const manifestValues = await Promise.all([manifest?.name, manifest?.short_name, manifest?.description].map((value) => readLocalizedManifestValue(extensionRoot, manifest, value)));
  const contentScripts = (manifest?.content_scripts ?? []).flatMap((script) => [...(script.matches ?? []), ...(script.js ?? []), ...(script.css ?? [])]);
  const permissions = [...(manifest?.permissions ?? []), ...(manifest?.host_permissions ?? []), ...(manifest?.optional_permissions ?? [])];
  return [...manifestValues, manifest?.homepage_url, manifest?.update_url, manifest?.author, ...contentScripts, ...permissions]
    .filter(Boolean)
    .join(' ');
}

function manifestMatchesRevsellerSearchText(text) {
  return /revseller|rev\s*seller|amazon\s*fba\s*(calculator|profit)|fba\s*(calculator|profit)/i.test(text);
}

async function inspectExtensionDirectory(profilePath, extensionId) {
  const extensionRoot = path.join(profilePath, 'Extensions', extensionId);
  const versions = await listDirectoriesIfExists(extensionRoot);
  const inspectedVersions = [];
  for (const version of versions) {
    const manifest = await readJsonIfExists(path.join(extensionRoot, version, 'manifest.json'));
    if (!manifest) continue;
    const name = await readLocalizedManifestValue(path.join(extensionRoot, version), manifest, manifest.name);
    const shortName = await readLocalizedManifestValue(path.join(extensionRoot, version), manifest, manifest.short_name);
    const description = await readLocalizedManifestValue(path.join(extensionRoot, version), manifest, manifest.description);
    const searchText = await manifestSearchText(path.join(extensionRoot, version), manifest);
    inspectedVersions.push({ version, manifest, name, shortName, description, searchText });
  }
  const latest = inspectedVersions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  return latest ? { extensionId, ...latest } : { extensionId, name: null, shortName: null, description: null, searchText: '' };
}

export async function inspectChromeProfileExtensions(profilePath) {
  const preferences = await readJsonIfExists(path.join(profilePath, 'Preferences'));
  const settings = preferences?.extensions?.settings ?? {};
  const extensionIds = new Set([
    ...Object.keys(settings),
    ...(await listDirectoriesIfExists(path.join(profilePath, 'Extensions')))
  ]);
  const detected = [];
  for (const extensionId of [...extensionIds].sort()) {
    const setting = settings[extensionId] ?? {};
    const disk = await inspectExtensionDirectory(profilePath, extensionId);
    const manifest = disk.manifest ?? setting.manifest ?? {};
    const preferenceRoot = path.join(profilePath, 'Extensions', extensionId, disk.version ?? '');
    const preferenceText = await manifestSearchText(preferenceRoot, manifest);
    detected.push({
      extensionId,
      name: disk.name ?? manifest.name ?? null,
      shortName: disk.shortName ?? manifest.short_name ?? null,
      description: disk.description ?? manifest.description ?? null,
      version: disk.version ?? manifest.version ?? null,
      enabled: setting.state !== 0,
      source: disk.manifest ? 'Extensions directory' : 'Preferences',
      matchesRevseller: setting.state !== 0 && manifestMatchesRevsellerSearchText(`${disk.searchText ?? ''} ${preferenceText}`)
    });
  }
  console.log(`Detected Chrome extensions in configured profile ${profilePath}: ${detected.length ? detected.map((extension) => `${extension.extensionId}=${extension.name ?? extension.shortName ?? '(unknown name)'}`).join(', ') : '(none)'}`);
  return detected;
}

export async function findRevsellerExtension(profilePath) {
  const extensions = await inspectChromeProfileExtensions(profilePath);
  return extensions.find((extension) => extension.matchesRevseller) ?? null;
}

export async function verifyRevsellerExtensionAvailable(profilePath) {
  const extension = await findRevsellerExtension(profilePath);
  if (!extension) throw new Error(revsellerUnavailableMessage);
  return extension;
}

async function verifyRevsellerPresenceFromLiveAmazonPage(context, { amazonProductUrl = revsellerVerificationAmazonProductUrl } = {}) {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(amazonProductUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(3_000).catch(() => undefined);
  const selector = '[id*="revseller" i], [class*="revseller" i], [data-testid*="revseller" i], [data-test*="revseller" i], [data-extension*="revseller" i], [data-extension-id*="revseller" i], [data-chrome-extension*="revseller" i], [aria-label*="revseller" i], iframe[src*="revseller" i], iframe[src^="chrome-extension://"], [id^="rs-"], [class^="rs-"], [class*=" rs-"], [data-rs], [data-rs-root], [data-revseller]';
  const frameResults = await Promise.all(page.frames().map(async (frame) => frame.evaluate((liveSelector) => {
    const text = document.body?.innerText || document.body?.textContent || '';
    const matched = [...document.querySelectorAll(liveSelector)].map((node) => ({ tagName: node.tagName, id: node.id || null, className: String(node.className || '') || null, src: node.getAttribute('src') || null }));
    return { url: location.href, title: document.title, matched, textMentionsRevseller: /revseller/i.test(text) };
  }, selector).catch((error) => ({ url: typeof frame.url === 'function' ? frame.url() : null, error: error.message, matched: [] }))));
  const present = frameResults.some((result) => result.textMentionsRevseller || result.matched?.length);
  console.log(`RevSeller live-page verification on ${page.url()}: ${present ? 'present' : 'not detected'}`);
  return { present, source: 'live Amazon product page DOM', pageUrl: page.url(), frameResults };
}

export async function launchAmazonBrowserSession({ chromium, chromePath, userDataDir, profileDirectory, launchOptions } = {}) {
  const config = resolveChromeProfileConfig({ chromePath, userDataDir, profileDirectory });
  let revsellerExtension = await findRevsellerExtension(config.profilePath);
  const chromiumLauncher = await loadChromium(chromium);
  if (isChromeProfileInUse(config.userDataDir)) {
    return connectToExistingChromeSession({ chromiumLauncher, config, revsellerExtension, liveVerificationOptions: launchOptions });
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
  if (!revsellerExtension) {
    const liveVerification = await verifyRevsellerPresenceFromLiveAmazonPage(context, launchOptions);
    if (!liveVerification.present) {
      await context.close().catch(() => {});
      throw new Error(revsellerUnavailableMessage);
    }
    revsellerExtension = { extensionId: null, name: 'RevSeller', source: liveVerification.source, liveVerification };
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
