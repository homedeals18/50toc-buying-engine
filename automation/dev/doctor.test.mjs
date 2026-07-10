import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseDotEnv, requiredArtifactFolders, runDoctor } from './doctor.mjs';

async function createChromeFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'doctor-fixture-'));
  const chromePath = path.join(tempDir, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
  const userDataDir = path.join(tempDir, 'User Data');
  const profileDirectory = 'Default';
  const profilePath = path.join(userDataDir, profileDirectory);
  await mkdir(profilePath, { recursive: true });
  await writeFile(chromePath, 'fake chrome');
  await writeFile(path.join(profilePath, 'Preferences'), JSON.stringify({
    extensions: { settings: { abcdefghijklmnopqrstuvwxyzabcdef: { state: 1, manifest: { name: 'RevSeller', description: 'Amazon FBA calculator' } } } }
  }));
  return { tempDir, chromePath, userDataDir, profileDirectory };
}

test('parseDotEnv reads simple quoted and unquoted values', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'doctor-env-'));
  const envPath = path.join(tempDir, '.env');
  try {
    await writeFile(envPath, 'AMAZON_CHROME_PATH="C:/Chrome/chrome.exe"\nAMAZON_CHROME_PROFILE_DIRECTORY=Default\n# ignored\n');
    assert.deepEqual(parseDotEnv(envPath), {
      AMAZON_CHROME_PATH: 'C:/Chrome/chrome.exe',
      AMAZON_CHROME_PROFILE_DIRECTORY: 'Default'
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('runDoctor checks Chrome, RevSeller, remote debugging, and artifact folders', async () => {
  const fixture = await createChromeFixture();
  try {
    const checks = await runDoctor({
      root: fixture.tempDir,
      env: {
        AMAZON_CHROME_PATH: fixture.chromePath,
        AMAZON_CHROME_USER_DATA_DIR: fixture.userDataDir,
        AMAZON_CHROME_PROFILE_DIRECTORY: fixture.profileDirectory,
        AMAZON_CHROME_CDP_ENDPOINT: 'http://127.0.0.1:9222'
      },
      fetchImpl: async (url) => {
        assert.equal(url, 'http://127.0.0.1:9222/json/version');
        return { ok: true, json: async () => ({ Browser: 'Chrome/fixture', webSocketDebuggerUrl: 'ws://fixture' }) };
      }
    });

    for (const name of ['Node', 'npm', 'Chrome executable', 'Chrome profile path', 'RevSeller extension presence', 'Remote debugging endpoint on port 9222', 'Required artifact folders']) {
      assert.equal(checks.find((check) => check.name === name)?.status, 'PASS');
    }
    for (const folder of requiredArtifactFolders) {
      const created = await stat(path.join(fixture.tempDir, folder));
      assert.equal(created.isDirectory(), true);
    }
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});
