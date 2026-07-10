import { createRequire } from 'node:module';
import { closeAmazonBrowserSession, defaultAmazonChromeCdpEndpoint, getAmazonBrowserSession, revsellerUnavailableMessage, revsellerVerificationAmazonProductUrl } from './browser-session/browser-session.mjs';

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

export async function runAttachCheck({ endpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT ?? defaultAmazonChromeCdpEndpoint, fetchImpl = fetch, chromium, getSession = getAmazonBrowserSession, closeSession = closeAmazonBrowserSession, amazonProductUrl = revsellerVerificationAmazonProductUrl } = {}) {
  const results = [];
  const pass = (name, detail) => results.push({ status: 'PASS', name, detail });
  const fail = (name, detail) => results.push({ status: 'FAIL', name, detail });

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
  } catch (error) {
    fail('Amazon page opened or inspected', error.message === revsellerUnavailableMessage ? 'RevSeller extension is not available in the attached Chrome profile.' : error.message);
    if (error.message === revsellerUnavailableMessage) fail('RevSeller is loaded', 'Install/sign in to RevSeller in the attached Chrome profile.');
  } finally {
    await closeSession().catch(() => undefined);
  }

  return results;
}

export function printAttachCheckResults(results, { log = console.log } = {}) {
  log('\nAmazon Attach Check Results');
  log('===========================');
  for (const result of results) {
    log(`${result.status} ${result.name}`);
    if (result.detail) log(`  ${result.detail}`);
  }
  const failures = results.filter((result) => result.status === 'FAIL').length;
  log(`\nSummary: ${results.length - failures} PASS, ${failures} FAIL`);
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runAttachCheck();
  process.exitCode = printAttachCheckResults(results) === 0 ? 0 : 1;
}
