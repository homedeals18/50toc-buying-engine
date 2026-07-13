import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { closeAmazonBrowserSession, defaultAmazonChromeCdpEndpoint, getAmazonBrowserSession, revsellerUnavailableMessage, probeLoginSessions, revsellerVerificationAmazonProductUrl } from './browser-session/browser-session.mjs';

export function versionUrlForEndpoint(endpoint) {
  return new URL('/json/version', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
}

export async function checkDebugVersion(endpoint = defaultAmazonChromeCdpEndpoint, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const versionUrl = versionUrlForEndpoint(endpoint);
  const response = await fetchImpl(versionUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${versionUrl} returned HTTP ${response.status}`);
  const version = await response.json().catch(() => ({}));
  if (!version.webSocketDebuggerUrl && !version.Browser) throw new Error(`${versionUrl} did not return a Chrome debugging version payload.`);
  return { versionUrl, version };
}

async function loadChromium() {
  const requireFromRevseller = createRequire(new URL('../revseller/package.json', import.meta.url));
  return requireFromRevseller('playwright').chromium;
}

export async function runAttachCheck({ endpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT ?? defaultAmazonChromeCdpEndpoint, fetchImpl = fetch, chromium, getSession = getAmazonBrowserSession, closeSession = closeAmazonBrowserSession, amazonProductUrl = revsellerVerificationAmazonProductUrl, onStep } = {}) {
  const results = [];
  const step = (message) => {
    if (onStep) onStep(message);
  };
  const pass = (name, detail) => results.push({ status: 'PASS', name, detail });
  const fail = (name, detail) => results.push({ status: 'FAIL', name, detail });

  step('Checking Chrome...');
  step('Checking profile...');
  step('Checking port 9222...');
  step('Checking DevTools...');
  step('Checking RevSeller...');

  let version;
  try {
    ({ version } = await checkDebugVersion(endpoint, { fetchImpl }));
    pass('Chrome attach mode is available', version.Browser ?? endpoint);
  } catch (error) {
    fail('Chrome attach mode is available', error.message);
    return results;
  }

  try {
    const context = await getSession({ chromium: chromium ?? await loadChromium(), launchOptions: { amazonProductUrl } });
    const page = context.pages()[0] ?? await context.newPage();
    if (!String(page.url?.() ?? '').includes('amazon.com')) await page.goto(amazonProductUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    pass('Amazon page opened or inspected', page.url?.() ?? amazonProductUrl);
    const revseller = context.amazonBrowserSession?.revsellerExtension;
    revseller ? pass('RevSeller is loaded', revseller.source ?? revseller.name ?? 'detected') : fail('RevSeller is loaded', 'No RevSeller metadata was found on the attached session.');
    const logins = await probeLoginSessions(page);
    logins.amazon.loggedIn ? pass('Amazon login is active', logins.amazon.url) : fail('Amazon login is active', 'Sign in to Amazon in the dedicated automation Chrome profile opened by start-chrome-debug.bat.');
  } catch (error) {
    fail('Amazon page opened or inspected', error.message === revsellerUnavailableMessage ? 'RevSeller extension is not available in the attached Chrome profile.' : error.message);
    if (error.message === revsellerUnavailableMessage) fail('RevSeller is loaded', 'Install/sign in to RevSeller in the attached Chrome profile.');
  } finally {
    await closeSession().catch(() => undefined);
  }

  return results;
}

export function printAttachCheckResults(results, { log = console.log } = {}) {
  const failures = results.filter((result) => result.status === 'FAIL');
  if (failures.length === 0) {
    log('PASS');
  } else {
    log('FAIL');
    log('Reason:');
    for (const result of failures) {
      log(`${result.name}: ${result.detail || 'Validation failed.'}`);
    }
  }
  return failures.length;
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isDirectRun()) {
  const results = await runAttachCheck({ onStep: console.log });
  process.exitCode = printAttachCheckResults(results) === 0 ? 0 : 1;
}
