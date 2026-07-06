import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cdpEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const cdpUrl = new URL(cdpEndpoint);
const remoteDebuggingPort = cdpUrl.port || '9222';
const automationDir = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(automationDir, '../../artifacts/bjs');
const defaultProfileDir = path.join(artifactRoot, 'manual-chrome-profile');
const manualChromeProfileDir = process.env.BJS_MANUAL_CHROME_PROFILE_DIR ?? defaultProfileDir;
const shouldLaunchChrome = process.env.BJS_SKIP_CHROME_LAUNCH !== 'true';

function candidateChromePaths() {
  if (process.env.BJS_CHROME_PATH) {
    return [process.env.BJS_CHROME_PATH];
  }

  if (process.platform === 'win32') {
    return [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
  }

  if (process.platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }

  return ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
}

function resolveChromeCommand() {
  const candidates = candidateChromePaths();

  if (process.platform === 'win32' || process.platform === 'darwin') {
    const chromePath = candidates.find((candidate) => existsSync(candidate));
    if (!chromePath) {
      throw new Error(`Unable to find Chrome. Set BJS_CHROME_PATH to your Chrome executable. Checked: ${candidates.join(', ')}`);
    }
    return chromePath;
  }

  return candidates[0];
}

async function waitForChrome() {
  const versionUrl = new URL('/json/version', cdpEndpoint).toString();
  const deadline = Date.now() + Number(process.env.BJS_CHROME_START_TIMEOUT_MS ?? 15_000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Chrome did not expose remote debugging at ${versionUrl}. Last error: ${lastError?.message ?? 'unknown error'}`);
}

function pipeChildErrors(child, label) {
  child.on('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    process.exit(1);
  });
}

async function launchChrome() {
  await mkdir(manualChromeProfileDir, { recursive: true });

  const chromeCommand = resolveChromeCommand();
  const chromeArgs = [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${manualChromeProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'https://www.bjs.com'
  ];

  const chrome = spawn(chromeCommand, chromeArgs, {
    detached: process.platform !== 'win32',
    stdio: 'ignore',
    windowsHide: false
  });
  pipeChildErrors(chrome, 'Chrome');
  chrome.unref();

  await waitForChrome();
}

async function main() {
  if (shouldLaunchChrome) {
    await launchChrome();
  }

  const playwrightCli = path.join(automationDir, 'node_modules', 'playwright', 'cli.js');
  const child = spawn(process.execPath, [playwrightCli, 'test', 'tests/deal-discovery.spec.js', '--project=chromium', '--headed'], {
    stdio: 'inherit',
    cwd: automationDir,
    env: { ...process.env, BJS_BROWSER_MODE: 'manual-chrome', BJS_CHROME_CDP_ENDPOINT: cdpEndpoint },
    windowsHide: false
  });

  pipeChildErrors(child, 'Playwright');

  child.on('exit', (code, signal) => {
    if (signal && process.platform !== 'win32') {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
