import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  defaultAmazonChromeCdpEndpoint,
  findRevsellerExtension,
  probeLoginSessions,
  resolveChromeProfileConfig
} from '../amazon/browser-session/browser-session.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const isWindows = process.platform === 'win32';
const defaultChromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const defaultUserDataDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\%USERNAME%\\AppData\\Local', 'Google', 'Chrome', 'User Data');
const defaultProfileDirectory = 'Default';
const requiredEnvVars = [
  'AMAZON_CHROME_PATH',
  'AMAZON_CHROME_USER_DATA_DIR',
  'AMAZON_CHROME_PROFILE_DIRECTORY',
  'AMAZON_CHROME_CDP_ENDPOINT'
];
const outputFolders = [
  'artifacts/bjs/logs',
  'artifacts/bjs/screenshots',
  'artifacts/costco_business_center/logs',
  'artifacts/costco_business_center/screenshots',
  'artifacts/sams_club/logs',
  'artifacts/sams_club/screenshots',
  'artifacts/main',
  'artifacts/amazon',
  'artifacts/revseller/logs',
  'artifacts/decision-engine',
  'artifacts/orchestrator'
];

function parseDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const parsed = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[match[1]] = value;
  }
  return parsed;
}

const dotEnv = parseDotEnv(path.join(repoRoot, '.env'));
for (const [key, value] of Object.entries(dotEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
if (process.env.AMAZON_CHROME_PATH === undefined && isWindows) process.env.AMAZON_CHROME_PATH = defaultChromePath;
if (process.env.AMAZON_CHROME_USER_DATA_DIR === undefined && isWindows) process.env.AMAZON_CHROME_USER_DATA_DIR = defaultUserDataDir;
if (process.env.AMAZON_CHROME_PROFILE_DIRECTORY === undefined && isWindows) process.env.AMAZON_CHROME_PROFILE_DIRECTORY = defaultProfileDirectory;
if (process.env.AMAZON_CHROME_CDP_ENDPOINT === undefined) process.env.AMAZON_CHROME_CDP_ENDPOINT = defaultAmazonChromeCdpEndpoint;

const checks = [];
function pass(name, fix) { checks.push({ name, ok: true, fix }); }
function fail(name, fix, detail) { checks.push({ name, ok: false, fix, detail }); }
function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { cwd: repoRoot, shell: isWindows, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}
function printCheck({ name, ok, fix, detail }) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (detail) console.log(`  ${detail}`);
  if (!ok && fix) console.log(`  Fix: ${fix}`);
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 18) pass('Node', `Installed Node ${process.version}.`);
else fail('Node', 'Install Node.js 18 or newer from https://nodejs.org/ and reopen your terminal.', `Found Node ${process.version}.`);

const npmCheck = commandExists('npm');
if (npmCheck.ok) pass('npm', npmCheck.output.split(/\r?\n/)[0]);
else fail('npm', 'Install Node.js from https://nodejs.org/. npm is bundled with Node.js, then reopen your terminal.', npmCheck.output || 'npm command was not found.');

const playwrightLocations = [
  'automation/bjs/node_modules/playwright',
  'automation/costco_business_center/node_modules/playwright',
  'automation/sams_club/node_modules/playwright',
  'automation/revseller/node_modules/playwright'
];
const missingPlaywright = playwrightLocations.filter((location) => !existsSync(path.join(repoRoot, location)));
if (missingPlaywright.length === 0) pass('Playwright', 'Playwright packages are installed for every automation connector.');
else fail('Playwright', 'Run setup.bat from the repository root, or run npm install in each automation/* package and npx playwright install chromium.', `Missing: ${missingPlaywright.join(', ')}`);

let profileConfig = null;
try {
  profileConfig = resolveChromeProfileConfig();
  pass('Chrome', `Found Chrome at ${profileConfig.chromePath}.`);
  pass('Chrome profile', `Found profile at ${profileConfig.profilePath}.`);
} catch (error) {
  const message = error.message || String(error);
  if (message.includes('AMAZON_CHROME_PATH')) fail('Chrome', 'Install Google Chrome, then set AMAZON_CHROME_PATH in .env to chrome.exe from chrome://version.', message);
  else fail('Chrome', 'Set AMAZON_CHROME_PATH in .env to regular Google Chrome chrome.exe from chrome://version.', 'Chrome path could not be verified.');
  if (message.includes('USER_DATA') || message.includes('profile')) fail('Chrome profile', 'Open chrome://version in the Chrome profile with RevSeller. Put the parent User Data folder in AMAZON_CHROME_USER_DATA_DIR and the last folder name in AMAZON_CHROME_PROFILE_DIRECTORY.', message);
  else fail('Chrome profile', 'Verify AMAZON_CHROME_USER_DATA_DIR and AMAZON_CHROME_PROFILE_DIRECTORY in .env.', 'Chrome profile was not verified because Chrome config is invalid.');
}

if (profileConfig) {
  try {
    const extension = await findRevsellerExtension(profileConfig.profilePath);
    if (extension) pass('RevSeller extension', `Detected ${extension.name || extension.extensionId} in ${profileConfig.profilePath}.`);
    else fail('RevSeller extension', 'Install RevSeller into this exact Chrome profile, log in to RevSeller, then rerun doctor.bat.', 'No enabled extension matching RevSeller was found in the configured profile.');
  } catch (error) {
    fail('RevSeller extension', 'Close Chrome if profile files are locked, verify the configured profile, and rerun doctor.bat.', error.message);
  }
} else {
  fail('RevSeller extension', 'Fix Chrome and Chrome profile checks first, then rerun doctor.bat.', 'Skipped because the Chrome profile could not be resolved.');
}

const envMissing = requiredEnvVars.filter((name) => !process.env[name]);
if (envMissing.length === 0) pass('required environment variables', `Found ${requiredEnvVars.join(', ')}.`);
else fail('required environment variables', 'Copy .env.example to .env and set the missing values for your Windows Chrome profile.', `Missing: ${envMissing.join(', ')}`);

const missingFolders = [];
for (const folder of outputFolders) {
  const fullPath = path.join(repoRoot, folder);
  if (!existsSync(fullPath)) {
    try { mkdirSync(fullPath, { recursive: true }); } catch {}
  }
  if (!existsSync(fullPath)) missingFolders.push(folder);
}
if (missingFolders.length === 0) pass('output folders', 'All artifact output folders exist or were created.');
else fail('output folders', 'Create the missing folders manually or rerun setup.bat as a user with write permission.', `Missing: ${missingFolders.join(', ')}`);

async function checkAmazonLogin() {
  if (missingPlaywright.length > 0) return fail('Amazon login', 'Install Playwright first by running setup.bat.', 'Skipped because Playwright is missing.');
  let chromium;
  try {
    const playwright = await import(path.join(repoRoot, 'automation/revseller/node_modules/playwright/index.js'));
    chromium = playwright.chromium ?? playwright.default?.chromium;
  } catch (error) {
    return fail('Amazon login', 'Run setup.bat to install the RevSeller Playwright dependency.', error.message);
  }
  const endpoint = process.env.AMAZON_CHROME_CDP_ENDPOINT || defaultAmazonChromeCdpEndpoint;
  try {
    if (!chromium) throw new Error('Playwright chromium launcher could not be loaded.');
    const browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Connected Chrome session has no browser context.');
    const page = context.pages()[0] || await context.newPage();
    const sessions = await probeLoginSessions(page);
    await browser.close().catch(() => {});
    if (sessions.amazon.loggedIn) pass('Amazon login', `Amazon appears logged in at ${sessions.amazon.url}.`);
    else fail('Amazon login', 'Start Chrome with start-chrome-debug.bat, open amazon.com in that window, sign in, and rerun doctor.bat.', `Amazon page loaded but sign-in state was not detected at ${sessions.amazon.url}.`);
  } catch (error) {
    fail('Amazon login', 'Run start-chrome-debug.bat, keep that Chrome window open, sign in to Amazon, then rerun doctor.bat.', `Could not connect to ${endpoint}: ${error.message}`);
  }
}

await checkAmazonLogin();

console.log('\n50TOC Buying Engine Doctor Results');
console.log('==================================');
for (const check of checks) printCheck(check);
const failures = checks.filter((check) => !check.ok).length;
console.log(`\nSummary: ${checks.length - failures} PASS, ${failures} FAIL`);
process.exitCode = failures === 0 ? 0 : 1;
