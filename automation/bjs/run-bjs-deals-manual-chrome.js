import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cdpEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const automationDir = path.dirname(fileURLToPath(import.meta.url));

async function waitForChrome() {
  const versionUrl = new URL('/json/version', cdpEndpoint).toString();
  const deadline = Date.now() + Number(process.env.BJS_CHROME_ATTACH_TIMEOUT_MS ?? 5_000);
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(versionUrl);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`BJ's manual Chrome mode attaches to your existing browser and will not launch Chrome. Start your normal Chrome session with --remote-debugging-port=9222, keep your BJ's login active in that browser, and set BJS_CHROME_CDP_ENDPOINT if you use a non-default endpoint. Unable to reach ${versionUrl}. Last error: ${lastError?.message ?? 'unknown error'}`);
}

function pipeChildErrors(child, label) {
  child.on('error', (error) => {
    console.error(`${label} failed to start: ${error.message}`);
    process.exit(1);
  });
}

async function main() {
  await waitForChrome();

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
