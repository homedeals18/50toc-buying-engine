import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDebugVersion, printAttachCheckResults, runAttachCheck, versionUrlForEndpoint } from './attach-check.mjs';

test('versionUrlForEndpoint targets /json/version on the configured endpoint', () => {
  assert.equal(versionUrlForEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222/json/version');
});

test('checkDebugVersion confirms a Chrome remote debugging payload', async () => {
  const result = await checkDebugVersion('http://127.0.0.1:9222', {
    fetchImpl: async (url) => {
      assert.equal(url, 'http://127.0.0.1:9222/json/version');
      return { ok: true, json: async () => ({ Browser: 'Chrome/test', webSocketDebuggerUrl: 'ws://test' }) };
    }
  });
  assert.equal(result.version.Browser, 'Chrome/test');
});

test('runAttachCheck opens or inspects Amazon and confirms RevSeller', async () => {
  const calls = [];
  let currentUrl = 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678';
  const fakePage = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url; calls.push(['goto', url]); },
    waitForTimeout: async () => {},
    frames: () => [{ evaluate: async () => ({ url: currentUrl, matched: [{ tagName: 'DIV', id: 'revseller-root' }], textMentionsRevseller: true }) }],
    locator: () => ({
      innerText: async () => currentUrl.includes('amazon.com') ? 'Account & Lists Orders' : 'RevSeller dashboard',
      first: () => ({ isVisible: async () => false })
    })
  };
  const fakeContext = {
    pages: () => [fakePage],
    amazonBrowserSession: { revsellerExtension: { source: 'fixture extension' } }
  };

  const results = await runAttachCheck({
    endpoint: 'http://127.0.0.1:9222',
    chromium: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chrome/test', webSocketDebuggerUrl: 'ws://test' }) }),
    getSession: async () => fakeContext,
    closeSession: async () => calls.push(['close']),
    amazonProductUrl: null
  });

  assert.deepEqual(calls, [['close']]);
  assert.equal(results.find((result) => result.name === 'Chrome attach mode is available')?.status, 'PASS');
  assert.equal(results.find((result) => result.name === 'attached page URL')?.status, 'PASS');
  assert.equal(results.find((result) => result.name === 'RevSeller panel detected')?.status, 'PASS');
  assert.equal(results.find((result) => result.name === 'Amazon login detected')?.status, 'PASS');
});


test('runAttachCheck reports validation steps and printAttachCheckResults prints PASS', async () => {
  const steps = [];
  const lines = [];
  let currentUrl = 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678';
  const fakePage = {
    url: () => currentUrl,
    goto: async (url) => { currentUrl = url; },
    waitForTimeout: async () => {},
    frames: () => [{ evaluate: async () => ({ url: currentUrl, matched: [{ tagName: 'DIV', id: 'revseller-root' }], textMentionsRevseller: true }) }],
    locator: () => ({
      innerText: async () => currentUrl.includes('amazon.com') ? 'Account & Lists Orders' : 'RevSeller dashboard',
      first: () => ({ isVisible: async () => false })
    })
  };
  const fakeContext = {
    pages: () => [fakePage],
    amazonBrowserSession: { revsellerExtension: { source: 'fixture extension' } }
  };

  const results = await runAttachCheck({
    endpoint: 'http://127.0.0.1:9222',
    chromium: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chrome/test', webSocketDebuggerUrl: 'ws://test' }) }),
    getSession: async () => fakeContext,
    closeSession: async () => undefined,
    onStep: (message) => steps.push(message)
  });

  assert.deepEqual(steps, [
    'Checking Chrome...',
    'Checking profile...',
    'Checking port 9222...',
    'Checking DevTools...',
    'Checking RevSeller...'
  ]);
  assert.equal(printAttachCheckResults(results, { log: (line) => lines.push(line) }), 0);
  assert.deepEqual(lines, [
    'attached page URL: https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678',
    'RevSeller panel detected: PASS',
    'Amazon login detected: PASS',
    'PASS'
  ]);
});


test('runAttachCheck does not navigate to the hardcoded RevSeller test ASIN', async () => {
  const forbidden = 'https://www.amazon.com/dp/B00000JY1X';
  let currentUrl = 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678';
  const fakePage = {
    url: () => currentUrl,
    goto: async (url) => {
      assert.notEqual(url, forbidden);
      currentUrl = url;
    },
    waitForTimeout: async () => {},
    frames: () => [{ evaluate: async () => ({ url: currentUrl, matched: [{ tagName: 'DIV', id: 'revseller-root' }], textMentionsRevseller: true }) }],
    locator: () => ({ innerText: async () => 'Account & Lists Orders' })
  };

  const results = await runAttachCheck({
    endpoint: 'http://127.0.0.1:9222',
    chromium: {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: 'Chrome/test', webSocketDebuggerUrl: 'ws://test' }) }),
    getSession: async ({ launchOptions }) => {
      assert.equal(launchOptions.amazonProductUrl, null);
      return { pages: () => [fakePage], amazonBrowserSession: {} };
    },
    closeSession: async () => undefined,
    amazonProductUrl: null
  });

  assert.equal(results.find((result) => result.name === 'RevSeller panel detected')?.status, 'PASS');
});

test('printAttachCheckResults prints FAIL with reasons', () => {
  const lines = [];
  const failures = printAttachCheckResults([
    { status: 'FAIL', name: 'Chrome attach mode is available', detail: 'connection refused' }
  ], { log: (line) => lines.push(line) });

  assert.equal(failures, 1);
  assert.deepEqual(lines, [
    'FAIL',
    'Reason:',
    'Chrome attach mode is available: connection refused'
  ]);
});
