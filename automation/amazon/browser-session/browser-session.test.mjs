import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLaunchOptions, closeAmazonBrowserSession, findRevsellerExtension, getAmazonBrowserSession, launchAmazonBrowserSession, resolveChromeProfileConfig, revsellerUnavailableMessage, verifyRevsellerExtensionAvailable } from './browser-session.mjs';

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

test('builds regular Chrome persistent launch options with profile directory', async () => {
  const fixture = await createChromeFixture();
  try {
    assert.deepEqual(buildLaunchOptions({ chromePath: fixture.chromePath, profileDirectory: fixture.profileDirectory, args: ['--custom-flag'] }), {
      executablePath: fixture.chromePath,
      headless: false,
      viewport: { width: 1440, height: 1000 },
      args: ['--disable-dev-shm-usage', '--no-sandbox', '--profile-directory=Default', '--custom-flag']
    });
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
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

test('stops with a clear message when RevSeller is not available', async () => {
  const fixture = await createChromeFixture({ withRevseller: false });
  try {
    await assert.rejects(() => verifyRevsellerExtensionAvailable(fixture.profilePath), { message: revsellerUnavailableMessage });
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('launches regular Chrome with the configured persistent user data dir and profile directory', async () => {
  const fixture = await createChromeFixture();
  const calls = [];
  const fakeContext = { pages: () => [], close: async () => {} };
  const chromium = {
    launchPersistentContext: async (userDataDir, options) => {
      calls.push({ userDataDir, options });
      return fakeContext;
    }
  };

  try {
    const context = await launchAmazonBrowserSession({ chromium, ...fixture, launchOptions: { headless: true } });
    assert.equal(context, fakeContext);
    assert.equal(calls[0].userDataDir, fixture.userDataDir);
    assert.equal(calls[0].options.executablePath, fixture.chromePath);
    assert.equal(calls[0].options.headless, true);
    assert.ok(calls[0].options.args.includes('--profile-directory=Default'));
    assert.equal(context.amazonBrowserSession.persistent, true);
    assert.equal(context.amazonBrowserSession.autoLogin, false);
    assert.equal(context.amazonBrowserSession.revsellerExtension.extensionId, 'abcdefghijklmnopqrstuvwxyzabcdef');
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test('reuses the same context promise until closed', async () => {
  const fixture = await createChromeFixture();
  let launches = 0;
  let closes = 0;
  const chromium = {
    launchPersistentContext: async () => {
      launches += 1;
      return { pages: () => [], close: async () => { closes += 1; } };
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
