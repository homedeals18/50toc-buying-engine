import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { closeAmazonBrowserSession, defaultAmazonChromeCdpEndpoint, getAmazonBrowserSession, revsellerUnavailableMessage, revsellerVerificationAmazonProductUrl, selectExistingAmazonProductPage, verifyRevsellerPresenceFromLiveAmazonPage } from './browser-session/browser-session.mjs';

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
    const page = selectExistingAmazonProductPage(context.pages());
    const liveVerification = await verifyRevsellerPresenceFromLiveAmazonPage(context, { amazonProductUrl });
    const attachedPageUrl = liveVerification.pageUrl ?? page?.url?.() ?? null;
    attachedPageUrl ? pass('attached page URL', attachedPageUrl) : fail('attached page URL', liveVerification.error ?? 'No already-open Amazon product page matched https://www.amazon.com/*/dp/*.');
    liveVerification.present ? pass('RevSeller panel detected', liveVerification.source) : fail('RevSeller panel detected', liveVerification.error ?? 'RevSeller panel was not detected in the live DOM of the attached Amazon product page.');
    const amazonText = page ? await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '') : '';
    const amazonLoggedIn = /\baccount\s*&\s*lists\b/i.test(amazonText) && !/\bsign\s*in\b/i.test(amazonText.slice(0, 1500));
    amazonLoggedIn ? pass('Amazon login detected', attachedPageUrl) : fail('Amazon login detected', 'Sign in to Amazon in the attached Chrome profile.');
  } catch (error) {
    fail('Amazon page opened or inspected', error.message === revsellerUnavailableMessage ? 'RevSeller extension is not available in the attached Chrome profile.' : error.message);
    if (error.message === revsellerUnavailableMessage) fail('RevSeller panel detected', 'Install/sign in to RevSeller in the attached Chrome profile.');
  } finally {
    await closeSession().catch(() => undefined);
  }

  return results;
}

export function printAttachCheckResults(results, { log = console.log } = {}) {
  const attachedPage = results.find((result) => result.name === 'attached page URL');
  const revsellerPanel = results.find((result) => result.name === 'RevSeller panel detected');
  const amazonLogin = results.find((result) => result.name === 'Amazon login detected');
  if (attachedPage) log(`attached page URL: ${attachedPage.detail ?? 'unavailable'}`);
  if (revsellerPanel) log(`RevSeller panel detected: ${revsellerPanel.status}`);
  if (amazonLogin) log(`Amazon login detected: ${amazonLogin.status}`);

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
  const failures = printAttachCheckResults(results);
  process.exitCode = results.some((result) => result.name === 'RevSeller panel detected' && result.status === 'PASS') ? 0 : failures === 0 ? 0 : 1;
}
