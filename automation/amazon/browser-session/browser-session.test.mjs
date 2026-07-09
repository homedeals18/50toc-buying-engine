import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLaunchOptions, closeAmazonBrowserSession, getAmazonBrowserSession, launchAmazonBrowserSession, resolveProfileDir } from './browser-session.mjs';

test('resolves the default profile beneath artifacts/amazon/browser-session', () => {
  assert.match(resolveProfileDir(), /artifacts[/\\]amazon[/\\]browser-session[/\\]chromium-profile$/);
});

test('builds safe persistent Chromium launch options', () => {
  assert.deepEqual(buildLaunchOptions({ args: ['--custom-flag'] }), {
    headless: false,
    viewport: { width: 1440, height: 1000 },
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--custom-flag']
  });
});

test('launches a persistent context with the shared profile directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'amazon-browser-session-'));
  const calls = [];
  const fakeContext = { pages: () => [], close: async () => {} };
  const chromium = {
    launchPersistentContext: async (profileDir, options) => {
      calls.push({ profileDir, options });
      return fakeContext;
    }
  };

  try {
    const context = await launchAmazonBrowserSession({ chromium, profileDir: tempDir, launchOptions: { headless: true } });
    assert.equal(context, fakeContext);
    assert.equal(calls[0].profileDir, tempDir);
    assert.equal(calls[0].options.headless, true);
    assert.equal(context.amazonBrowserSession.persistent, true);
    assert.equal(context.amazonBrowserSession.autoLogin, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('reuses the same context promise until closed', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'amazon-browser-session-'));
  let launches = 0;
  let closes = 0;
  const chromium = {
    launchPersistentContext: async () => {
      launches += 1;
      return { pages: () => [], close: async () => { closes += 1; } };
    }
  };

  try {
    const first = await getAmazonBrowserSession({ chromium, profileDir: tempDir });
    const second = await getAmazonBrowserSession({ chromium, profileDir: tempDir });
    assert.equal(first, second);
    assert.equal(launches, 1);
    await closeAmazonBrowserSession();
    assert.equal(closes, 1);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
