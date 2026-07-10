import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  defaultAmazonChromeCdpEndpoint,
  findRevsellerExtension,
  resolveChromeProfileConfig
} from '../amazon/browser-session/browser-session.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const requiredArtifactFolders = [
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

export function parseDotEnv(filePath) {
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

export function loadDotEnv({ env = process.env, root = repoRoot } = {}) {
  for (const [key, value] of Object.entries(parseDotEnv(path.join(root, '.env')))) {
    if (env[key] === undefined) env[key] = value;
  }
  if (env.AMAZON_CHROME_CDP_ENDPOINT === undefined) env.AMAZON_CHROME_CDP_ENDPOINT = defaultAmazonChromeCdpEndpoint;
  return env;
}

function commandExists(command, args = ['--version'], { root = repoRoot, isWindows = process.platform === 'win32' } = {}) {
  const result = spawnSync(command, args, { cwd: root, shell: isWindows, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

export async function probeRemoteDebuggingEndpoint(endpoint = defaultAmazonChromeCdpEndpoint, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const versionUrl = new URL('/json/version', endpoint.endsWith('/') ? endpoint : `${endpoint}/`).toString();
  const response = await fetchImpl(versionUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { ok: false, detail: `${versionUrl} returned HTTP ${response.status}` };
  const payload = await response.json().catch(() => ({}));
  return {
    ok: Boolean(payload.webSocketDebuggerUrl || payload.Browser),
    detail: payload.Browser ?? 'Chrome remote debugging endpoint responded'
  };
}

export async function runDoctor({ root = repoRoot, env = process.env, fetchImpl = fetch, ensureFolders = true } = {}) {
  loadDotEnv({ env, root });
  const checks = [];
  const pass = (name, detail) => checks.push({ name, status: 'PASS', detail });
  const fail = (name, detail, fix) => checks.push({ name, status: 'FAIL', detail, fix });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  nodeMajor >= 18 ? pass('Node', process.version) : fail('Node', `Found ${process.version}`, 'Install Node.js 18 or newer.');

  const npmCheck = commandExists('npm', ['--version'], { root });
  npmCheck.ok ? pass('npm', npmCheck.output.split(/\r?\n/)[0]) : fail('npm', npmCheck.output || 'npm command was not found.', 'Install Node.js, which includes npm.');

  let profileConfig = null;
  try {
    profileConfig = resolveChromeProfileConfig({
      chromePath: env.AMAZON_CHROME_PATH,
      userDataDir: env.AMAZON_CHROME_USER_DATA_DIR,
      profileDirectory: env.AMAZON_CHROME_PROFILE_DIRECTORY
    });
    pass('Chrome executable', profileConfig.chromePath);
    pass('Chrome profile path', profileConfig.profilePath);
  } catch (error) {
    fail('Chrome executable', error.message, 'Set AMAZON_CHROME_PATH to regular Google Chrome.');
    fail('Chrome profile path', error.message, 'Set AMAZON_CHROME_USER_DATA_DIR and AMAZON_CHROME_PROFILE_DIRECTORY for the RevSeller profile.');
  }

  if (profileConfig) {
    const extension = await findRevsellerExtension(profileConfig.profilePath);
    extension ? pass('RevSeller extension presence', `${extension.name || extension.extensionId} (${extension.source})`) : fail('RevSeller extension presence', 'RevSeller was not found in the configured Chrome profile.', 'Install/sign in to RevSeller in this exact profile.');
  } else {
    fail('RevSeller extension presence', 'Skipped because the Chrome profile path could not be resolved.', 'Fix Chrome profile settings first.');
  }

  try {
    const remote = await probeRemoteDebuggingEndpoint(env.AMAZON_CHROME_CDP_ENDPOINT || defaultAmazonChromeCdpEndpoint, { fetchImpl });
    remote.ok ? pass('Remote debugging endpoint on port 9222', remote.detail) : fail('Remote debugging endpoint on port 9222', remote.detail, 'Run start-chrome-debug.bat and keep Chrome open.');
  } catch (error) {
    fail('Remote debugging endpoint on port 9222', error.message, 'Run start-chrome-debug.bat and keep Chrome open.');
  }

  const missingFolders = [];
  for (const folder of requiredArtifactFolders) {
    const fullPath = path.join(root, folder);
    if (!existsSync(fullPath) && ensureFolders) mkdirSync(fullPath, { recursive: true });
    if (!existsSync(fullPath)) missingFolders.push(folder);
  }
  missingFolders.length === 0 ? pass('Required artifact folders', 'All artifact folders exist or were created.') : fail('Required artifact folders', `Missing: ${missingFolders.join(', ')}`, 'Create the missing artifact folders.');

  return checks;
}

export function printDoctorResults(checks, { log = console.log } = {}) {
  log('\n50TOC Buying Engine Doctor Results');
  log('==================================');
  for (const check of checks) {
    log(`${check.status} ${check.name}`);
    if (check.detail) log(`  ${check.detail}`);
    if (check.status === 'FAIL' && check.fix) log(`  Fix: ${check.fix}`);
  }
  const failures = checks.filter((check) => check.status === 'FAIL').length;
  log(`\nSummary: ${checks.length - failures} PASS, ${failures} FAIL`);
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await runDoctor();
  process.exitCode = printDoctorResults(checks) === 0 ? 0 : 1;
}
