import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConnectorRegistry, runMainBuyingEngine, toProjectRelativePath, resolveProjectPath, resolveArtifactPath } from '../main/run-main-buying-engine.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const supportsColor = process.env.NO_COLOR === undefined && (process.stdout.isTTY || process.env.FORCE_COLOR);
const color = (code, value) => supportsColor ? `\u001b[${code}m${value}\u001b[0m` : value;
const green = (value) => color(32, value);
const red = (value) => color(31, value);
const yellow = (value) => color(33, value);
const cyan = (value) => color(36, value);
const bold = (value) => color(1, value);

const connectors = [
  {
    id: 'bjs',
    label: "BJ's",
    env: 'BJS_CONNECTOR_ENABLED',
    defaultEnabled: true,
    command: 'npm',
    args: ['run', 'scrape:bjs:deals'],
    artifactPath: resolveArtifactPath('bjs', 'logs', 'deal-products.json'),
    gracefulFailure: true
  },
  {
    id: 'costco_business_center',
    label: 'Costco',
    env: 'COSTCO_BUSINESS_CENTER_CONNECTOR_ENABLED',
    defaultEnabled: true,
    command: 'npm',
    args: ['run', 'scrape:costco-business-center:instant-savings'],
    artifactPath: resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json')
  }
];

const requiredFolders = [
  'automation/bjs',
  'automation/costco_business_center',
  'automation/main',
  'artifacts/bjs/logs',
  'artifacts/costco_business_center/logs',
  'artifacts/main'
];

function enabledByEnv(connector) {
  const raw = process.env[connector.env];
  if (raw === undefined || raw === '') return connector.defaultEnabled;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(String(raw).trim().toLowerCase());
}

function printHeader() {
  console.log('====================================');
  console.log(bold('50TOC Buying Engine'));
  console.log('====================================\n');
}

function formatSummaryLine(label, status, detail = '') {
  const dotted = `${label} ${'.'.repeat(Math.max(1, 22 - label.length))}`;
  const renderedStatus = status === 'PASS' ? green(status) : status === 'FAIL' ? red(status) : yellow(status);
  console.log(`${dotted} ${renderedStatus}${detail ? ` ${detail}` : ''}`);
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repositoryRoot, shell: process.platform === 'win32', stdio: 'inherit', env: process.env });
    child.on('error', (error) => resolve({ ok: false, error, code: 1 }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });
}

async function verifyRepositoryStatus() {
  const result = await new Promise((resolve) => {
    const child = spawn('git', ['status', '--short'], { cwd: repositoryRoot, shell: process.platform === 'win32' });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', (error) => resolve({ ok: false, message: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, message: output.trim() }));
  });

  if (!result.ok) return { status: 'FAIL', detail: `(${result.message || 'git status failed'})` };
  if (result.message) return { status: 'WARN', detail: '(working tree has local changes)' };
  return { status: 'PASS', detail: '(clean)' };
}

async function verifyRequiredFolders() {
  const missing = [];
  for (const folder of requiredFolders) {
    const absolute = resolveProjectPath(folder);
    if (!existsSync(absolute)) {
      await mkdir(absolute, { recursive: true });
      missing.push(folder);
    }
  }
  return missing.length ? { status: 'WARN', detail: `(created ${missing.length} missing folders)` } : { status: 'PASS', detail: '' };
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function productCount(filePath) {
  try {
    const parsed = await readJson(filePath);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

export async function runConnector(connector) {
  if (!enabledByEnv(connector)) return { label: connector.label, status: 'SKIP', detail: '(disabled)' };
  console.log(cyan(`[dev:all] Running ${connector.label} connector...`));
  const result = await runCommand(connector.command, connector.args);
  const count = await productCount(connector.artifactPath);
  if (!result.ok) {
    const detail = count === null ? `(unavailable, exit ${result.code})` : `(unavailable, exit ${result.code}, ${count} products)`;
    return { label: connector.label, status: connector.gracefulFailure ? 'WARN' : 'FAIL', detail };
  }
  return { label: connector.label, status: 'PASS', detail: count === null ? '' : `(${count} products)` };
}

export const generatedReportFileNames = new Set([
  'deal-products.json',
  'shopping-list-report.json',
  'deal-execution-report.json',
  'final-shopping-list.json',
  'final-execution-report.json'
]);

export const generatedJsonArtifactPaths = [
  resolveArtifactPath('bjs', 'logs', 'deal-products.json'),
  resolveArtifactPath('bjs', 'logs', 'shopping-list-report.json'),
  resolveArtifactPath('bjs', 'logs', 'deal-execution-report.json'),
  resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json'),
  resolveArtifactPath('costco_business_center', 'logs', 'shopping-list-report.json'),
  resolveArtifactPath('costco_business_center', 'logs', 'deal-execution-report.json'),
  resolveArtifactPath('main', 'final-shopping-list.json'),
  resolveArtifactPath('main', 'final-execution-report.json')
].filter((file) => generatedReportFileNames.has(path.basename(file)));

export async function validateGeneratedJson(filesToValidate = generatedJsonArtifactPaths) {
  const files = filesToValidate.filter((file) => generatedReportFileNames.has(path.basename(file)) && existsSync(file));
  const failures = [];
  for (const file of files) {
    try { await readJson(file); } catch (error) { failures.push(`${toProjectRelativePath(file)}: ${error.message}`); }
  }
  return { status: failures.length ? 'FAIL' : 'PASS', detail: failures.length ? `(${failures.length} invalid files)` : `(${files.length} files)`, failures };
}

export async function runDevAll() {
  printHeader();
  const summary = [];
  summary.push({ label: 'Repository', ...(await verifyRepositoryStatus()) });
  summary.push({ label: 'Folders', ...(await verifyRequiredFolders()) });

  for (const connector of connectors) {
    summary.push(await runConnector(connector));
  }

  let mainFailed = false;
  try {
    console.log(cyan('[dev:all] Running Main Buying Engine...'));
    await runMainBuyingEngine(defaultConnectorRegistry.map((entry) => {
      const devConnector = connectors.find((connector) => connector.id === entry.id);
      return devConnector ? { ...entry, enabled: enabledByEnv(devConnector) } : entry;
    }));
    summary.push({ label: 'Main Engine', status: 'PASS', detail: '' });
  } catch (error) {
    mainFailed = true;
    summary.push({ label: 'Main Engine', status: 'FAIL', detail: `(${error.message})` });
  }

  const shoppingCount = await productCount(resolveArtifactPath('main', 'final-shopping-list.json'));
  summary.push({ label: 'Shopping List', status: shoppingCount === null ? 'FAIL' : 'PASS', detail: shoppingCount === null ? '(missing or invalid)' : `(${shoppingCount} products)` });
  summary.push({ label: 'Execution Report', status: existsSync(resolveArtifactPath('main', 'final-execution-report.json')) ? 'PASS' : 'FAIL', detail: '' });
  const validation = await validateGeneratedJson();
  summary.push({ label: 'JSON Validation', status: validation.status, detail: validation.detail });

  console.log('\n====================================');
  for (const item of summary) formatSummaryLine(item.label, item.status, item.detail);
  if (validation.failures?.length) {
    console.log('\nInvalid JSON files:');
    for (const failure of validation.failures) console.log(`- ${failure}`);
  }
  console.log('====================================');
  console.log(mainFailed ? red('Finished With Main Engine Failure') : green('Finished Successfully'));
  console.log('====================================');

  process.exitCode = mainFailed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDevAll();
}
