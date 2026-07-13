import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromeAttachRequiredMessage, closeAmazonBrowserSession, findRevsellerExtension, getAmazonBrowserSession, inspectChromeProfileExtensions, launchAmazonBrowserSession, resolveChromeAttachConfig, resolveChromeProfileConfig, revsellerUnavailableMessage, verifyRevsellerExtensionAvailable, selectExistingAmazonProductPage } from './browser-session.mjs';

async function createChromeFixture({ withRevseller = true } = {}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'amazon-browser-session-'));
  const chromePath = path.join(tempDir, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
  const userDataDir = path.join(tempDir, 'User Data');
  const profileDirectory = 'Default';
  const profilePath = path.join(userDataDir, profileDirectory);
  await mkdir(profilePath, { recursive: true });
  await writeFile(chromePath, 'fake chrome');
  await writeFile(path.join(profilePath, 'Preferences'), JSON.stringify({
    extensions: {
      settings: withRevseller ? {
        abcdefghijklmnopqrstuvwxyzabcdef: {
          state: 1,
          manifest: { name: 'RevSeller', description: 'Amazon FBA calculator' }
        }
      } : {}
    }
  }));
  return { tempDir, chromePath, userDataDir, profileDirectory, profilePath };
}

test('resolves configured Chrome profile paths without creating a fresh profile', async () => {
  const fixture = await createChromeFixture();
  try {
    const config = resolveChromeProfileConfig(fixture);
    assert.equal(config.chromePath, fixture.chromePath);
    assert.equal(config.userDataDir, fixture.userDataDir);
    assert.equal(config.profileDirectory, fixture.profileDirectory);
    assert.equal(config.profilePath, fixture.profilePath);
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('resolves Chrome attach endpoint without launch options', () => {
  assert.deepEqual(resolveChromeAttachConfig(), { cdpEndpoint: 'http://127.0.0.1:9222' });
  assert.deepEqual(resolveChromeAttachConfig({ cdpEndpoint: 'http://127.0.0.1:9333' }), { cdpEndpoint: 'http://127.0.0.1:9333' });
});

test('finds the RevSeller extension in the configured Chrome profile preferences', async () => {
  const fixture = await createChromeFixture();
  try {
    const extension = await findRevsellerExtension(fixture.profilePath);
    assert.equal(extension.extensionId, 'abcdefghijklmnopqrstuvwxyzabcdef');
    assert.equal(extension.source, 'Preferences');
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('inspects the configured Chrome profile Extensions directory and resolves localized RevSeller manifests', async () => {
  const fixture = await createChromeFixture({ withRevseller: false });
  const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const extensionVersionPath = path.join(fixture.profilePath, 'Extensions', extensionId, '1.2.3');
  try {
    await mkdir(path.join(extensionVersionPath, '_locales', 'en'), { recursive: true });
    await writeFile(path.join(extensionVersionPath, 'manifest.json'), JSON.stringify({
      name: '__MSG_appName__',
      description: 'Amazon FBA calculator and profit tools',
      default_locale: 'en',
      content_scripts: [{ matches: ['https://www.amazon.com/*'], js: ['revseller-content.js'] }]
    }));
    await writeFile(path.join(extensionVersionPath, '_locales', 'en', 'messages.json'), JSON.stringify({ appName: { message: 'RevSeller' } }));

    const extensions = await inspectChromeProfileExtensions(fixture.profilePath);
    const extension = await findRevsellerExtension(fixture.profilePath);
    assert.ok(extensions.some((candidate) => candidate.extensionId === extensionId && candidate.name === 'RevSeller'));
    assert.equal(extension.extensionId, extensionId);
    assert.equal(extension.source, 'Extensions directory');
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});


test('selects an already-open Amazon product page before other pages', () => {
  const productPage = { url: () => 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678' };
  const pages = [
    { url: () => 'https://www.amazon.com/' },
    productPage,
    { url: () => 'https://www.revseller.com/' }
  ];
  assert.equal(selectExistingAmazonProductPage(pages), productPage);
});

test('falls back to live Amazon product page DOM verification when profile inspection misses RevSeller', async () => {
  const fixture = await createChromeFixture({ withRevseller: false });
  const calls = [];
  const fakePage = {
    goto: async (url) => { calls.push(['goto', url]); },
    waitForTimeout: async () => {},
    url: () => 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678',
    frames: () => [{
      evaluate: async () => ({ url: 'https://www.amazon.com/Nexxus-Humectress-Moisturizing-ProteinFusion-Conditioner/dp/B012345678', matched: [{ tagName: 'DIV', id: 'revseller-root' }], textMentionsRevseller: true })
    }]
  };
  const fakeContext = { pages: () => [fakePage], close: async () => { calls.push(['close']); } };
  const chromium = {
    connectOverCDP: async () => ({ contexts: () => [fakeContext], close: async () => {} })
  };

  try {
    const context = await launchAmazonBrowserSession({ chromium, ...fixture, launchOptions: { amazonProductUrl: null } });
    assert.equal(context, fakeContext);
    assert.equal(context.amazonBrowserSession.revsellerExtension.source, 'live Amazon product page DOM');
    assert.deepEqual(calls, []);
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('stops with a clear message when RevSeller is not available', async () => {
  const fixture = await createChromeFixture({ withRevseller: false });
  try {
    await assert.rejects(() => verifyRevsellerExtensionAvailable(fixture.profilePath), { message: revsellerUnavailableMessage });
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('attaches to Chrome over CDP and never launches a persistent profile', async () => {
  const fixture = await createChromeFixture();
  const calls = [];
  const fakeContext = { pages: () => [], close: async () => {} };
  const chromium = {
    connectOverCDP: async (endpoint) => {
      calls.push(endpoint);
      return { contexts: () => [fakeContext], close: async () => {} };
    },
    launchPersistentContext: async () => {
      throw new Error('must not launch Chrome');
    }
  };

  try {
    const context = await launchAmazonBrowserSession({ chromium, ...fixture, cdpEndpoint: 'http://127.0.0.1:9333' });
    assert.equal(context, fakeContext);
    assert.deepEqual(calls, ['http://127.0.0.1:9333']);
    assert.equal(context.amazonBrowserSession.connectedOverCDP, true);
    assert.equal(context.amazonBrowserSession.autoLogin, false);
    assert.equal(context.amazonBrowserSession.revsellerExtension.extensionId, 'abcdefghijklmnopqrstuvwxyzabcdef');
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});


test('connects to an existing Chrome session even when profile lock files exist', async () => {
  const fixture = await createChromeFixture();
  const fakeContext = { pages: () => [], close: async () => {} };
  const calls = [];
  const chromium = {
    connectOverCDP: async (endpoint) => {
      calls.push(endpoint);
      return { contexts: () => [fakeContext], close: async () => {} };
    },
    launchPersistentContext: async () => {
      throw new Error('must not launch a second Chrome instance');
    }
  };

  try {
    const context = await launchAmazonBrowserSession({ chromium, ...fixture });
    assert.equal(context, fakeContext);
    assert.deepEqual(calls, ['http://127.0.0.1:9222']);
    assert.equal(context.amazonBrowserSession.connectedOverCDP, true);
    assert.equal(context.amazonBrowserSession.profileDirectory, 'Default');
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('fails clearly when Chrome cannot be attached over CDP', async () => {
  const fixture = await createChromeFixture();
  const chromium = {
    connectOverCDP: async () => {
      throw new Error('connection refused');
    }
  };

  try {
    await assert.rejects(
      () => launchAmazonBrowserSession({ chromium, ...fixture }),
      (error) => error.message.includes(chromeAttachRequiredMessage) && error.message.includes('connection refused')
    );
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('reuses the same context promise until closed', async () => {
  const fixture = await createChromeFixture();
  let launches = 0;
  let closes = 0;
  const chromium = {
    connectOverCDP: async () => {
      launches += 1;
      return { contexts: () => [{ pages: () => [], close: async () => { closes += 1; } }], close: async () => {} };
    }
  };

  try {
    const first = await getAmazonBrowserSession({ chromium, ...fixture });
    const second = await getAmazonBrowserSession({ chromium, ...fixture });
    assert.equal(first, second);
    assert.equal(launches, 1);
    await closeAmazonBrowserSession();
    assert.equal(closes, 1);
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});
