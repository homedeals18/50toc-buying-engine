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
  const fakePage = {
    url: () => 'about:blank',
    goto: async (url) => calls.push(['goto', url])
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
    amazonProductUrl: 'https://www.amazon.com/dp/B00000JY1X'
  });

  assert.deepEqual(calls, [['goto', 'https://www.amazon.com/dp/B00000JY1X'], ['close']]);
  assert.equal(results.find((result) => result.name === 'Chrome attach mode is available')?.status, 'PASS');
  assert.equal(results.find((result) => result.name === 'Amazon page opened or inspected')?.status, 'PASS');
  assert.equal(results.find((result) => result.name === 'RevSeller is loaded')?.status, 'PASS');
});


test('runAttachCheck reports validation steps and printAttachCheckResults prints PASS', async () => {
  const steps = [];
  const lines = [];
  const fakePage = {
    url: () => 'https://www.amazon.com/dp/B00000JY1X',
    goto: async () => assert.fail('should not navigate when already on Amazon')
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
  assert.deepEqual(lines, ['PASS']);
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
