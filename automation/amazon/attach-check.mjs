import { createRequire } from 'node:module';
import { closeAmazonBrowserSession, defaultAmazonChromeCdpEndpoint, getAmazonBrowserSession, revsellerUnavailableMessage } from './browser-session/browser-session.mjs';

const requireFromRevseller = createRequire(new URL('../revseller/package.json', import.meta.url));
const { chromium } = requireFromRevseller('playwright');

const endpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT ?? defaultAmazonChromeCdpEndpoint;
const versionUrl = new URL('/json/version', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();

async function verifyDebuggingPort() {
  let response;
  try {
    response = await fetch(versionUrl, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(`Chrome Attach Mode is not reachable at ${versionUrl}. Run start-chrome-debug.bat first. ${error.message}`);
  }

  if (!response.ok) {
    throw new Error(`Chrome Attach Mode endpoint ${versionUrl} returned HTTP ${response.status}. Run start-chrome-debug.bat first.`);
  }

  const version = await response.json().catch(() => ({}));
  if (!version.webSocketDebuggerUrl && !version.Browser) {
    throw new Error(`Chrome Attach Mode endpoint ${versionUrl} did not return a valid Chrome debugging version payload.`);
  }

  return version;
}

async function main() {
  const version = await verifyDebuggingPort();
  const context = await getAmazonBrowserSession({ chromium });
  console.log(`Chrome Attach Mode is reachable at ${endpoint}.`);
  console.log(`Connected browser: ${version.Browser ?? 'Chrome'}.`);
  console.log(`RevSeller is available from ${context.amazonBrowserSession?.revsellerExtension?.source ?? 'the attached Chrome session'}.`);
  await closeAmazonBrowserSession();
}

main().catch(async (error) => {
  await closeAmazonBrowserSession().catch(() => undefined);
  if (error.message === revsellerUnavailableMessage) {
    console.error('RevSeller extension is not available in the attached Chrome profile. Install/sign in to RevSeller in the same Chrome profile before running analysis.');
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});
