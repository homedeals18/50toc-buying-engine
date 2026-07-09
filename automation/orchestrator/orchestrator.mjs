import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMainBuyingEngine, defaultConnectorRegistry, resolveArtifactPath, toProjectRelativePath } from '../main/run-main-buying-engine.mjs';
import { runAmazonProductDiscovery } from '../shared/amazon-product-discovery.mjs';
import { runDecisionEngine } from '../decision-engine/decision-engine.mjs';
import { produceFinalShoppingList } from './final-shopping-list.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const orchestratorArtifactRoot = path.join(repositoryRoot, 'artifacts', 'orchestrator');
export const finalRunReportPath = path.join(orchestratorArtifactRoot, 'final-run-report.json');
export const executionLogPath = path.join(orchestratorArtifactRoot, 'execution-log.json');

export const connectorModules = [
  { id: 'bjs', name: "BJ's Wholesale Club Connector", enabledEnv: 'BJS_CONNECTOR_ENABLED', defaultEnabled: true, command: 'npm', args: ['run', 'scrape:bjs:deals:manual-chrome:direct'], outputPath: resolveArtifactPath('bjs', 'logs', 'deal-products.json') },
  { id: 'costco_business_center', name: 'Costco Business Center Connector', enabledEnv: 'COSTCO_BUSINESS_CENTER_CONNECTOR_ENABLED', defaultEnabled: true, command: 'npm', args: ['run', 'scrape:costco-business-center:instant-savings'], outputPath: resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json') },
  { id: 'sams_club', name: "Sam's Club Connector", enabledEnv: 'SAMS_CLUB_CONNECTOR_ENABLED', defaultEnabled: true, command: 'npm', args: ['run', 'scrape:sams-club:clearance'], outputPath: resolveArtifactPath('sams_club', 'logs', 'deal-products.json') }
];

function nowIso() { return new Date().toISOString(); }
function elapsedMs(started) { return Math.max(0, Date.now() - started); }
function enabledByEnv(module, env = process.env) {
  const value = env[module.enabledEnv];
  if (value === undefined || value === '') return module.defaultEnabled !== false;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(String(value).trim().toLowerCase());
}
async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}
function previousPass(previousReport, id) {
  return previousReport?.modules?.find((module) => module.id === id && module.status === 'PASS') ?? null;
}
function skippedFromPrevious(previous) {
  return { ...previous, skipped: true, skipReason: 'previous successful completion', rerun: false };
}
function runCommand(command, args, { env = process.env } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, { cwd: repositoryRoot, shell: process.platform === 'win32', env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', (error) => resolve({ ok: false, code: 1, error: error.message, stdout, stderr, elapsedMs: elapsedMs(started) }));
    child.on('close', (code) => resolve({ ok: code === 0, code, stdout, stderr, elapsedMs: elapsedMs(started) }));
  });
}
async function runMeasured(id, name, work, previousReport, outputPath) {
  const previous = previousPass(previousReport, id);
  if (previous && (!outputPath || existsSync(outputPath))) return skippedFromPrevious(previous);
  const startedAt = nowIso();
  const started = Date.now();
  try {
    const result = await work();
    return { id, name, status: 'PASS', startedAt, completedAt: nowIso(), elapsedMs: elapsedMs(started), outputPath: outputPath ? toProjectRelativePath(outputPath) : undefined, result };
  } catch (error) {
    return { id, name, status: 'FAIL', startedAt, completedAt: nowIso(), elapsedMs: elapsedMs(started), outputPath: outputPath ? toProjectRelativePath(outputPath) : undefined, error: error.message };
  }
}
async function runConnectorModule(connector, previousReport, { env = process.env, commandRunner = runCommand } = {}) {
  const id = `connector:${connector.id}`;
  const enabled = enabledByEnv(connector, env);
  if (!enabled) return { id, name: connector.name, status: 'SKIP', elapsedMs: 0, skipped: true, skipReason: 'disabled' };
  const previous = previousPass(previousReport, id);
  if (previous && existsSync(connector.outputPath)) return skippedFromPrevious(previous);
  const startedAt = nowIso();
  const result = await commandRunner(connector.command, connector.args, { env });
  return { id, name: connector.name, status: result.ok ? 'PASS' : 'FAIL', startedAt, completedAt: nowIso(), elapsedMs: result.elapsedMs, command: [connector.command, ...connector.args].join(' '), outputPath: toProjectRelativePath(connector.outputPath), exitCode: result.code, error: result.ok ? undefined : (result.error ?? `exit ${result.code}`) };
}

export async function runOrchestrator({ env = process.env, commandRunner = runCommand } = {}) {
  await mkdir(orchestratorArtifactRoot, { recursive: true });
  const previousReport = await readJsonIfExists(finalRunReportPath);
  const modules = [];
  const startedAt = nowIso();
  const started = Date.now();

  const connectorResults = await Promise.all(connectorModules.map((connector) => runConnectorModule(connector, previousReport, { env, commandRunner })));
  modules.push(...connectorResults);

  modules.push(await runMeasured('main-buying-engine', 'Main Buying Engine', async () => {
    const connectors = defaultConnectorRegistry.map((entry) => ({ ...entry, enabled: connectorResults.some((result) => result.id === `connector:${entry.id}` && ['PASS', 'FAIL'].includes(result.status)) }));
    const { finalProducts, report } = await runMainBuyingEngine(connectors);
    return { products: finalProducts.length, totals: report.totals };
  }, previousReport, resolveArtifactPath('main', 'final-shopping-list.json')));

  modules.push(await runMeasured('amazon-product-discovery', 'Amazon Product Discovery', () => runAmazonProductDiscovery(), previousReport, resolveArtifactPath('amazon', 'product-discovery.json')));
  modules.push(await runMeasured('revseller-reader', 'Revseller Reader', () => commandRunner('npm', ['run', 'read:revseller'], { env }).then((result) => { if (!result.ok) throw new Error(result.error ?? `exit ${result.code}`); return { exitCode: result.code }; }), previousReport, resolveArtifactPath('revseller', 'revseller-analysis-report.json')));
  modules.push(await runMeasured('decision-engine', 'Decision Engine', () => runDecisionEngine(), previousReport, resolveArtifactPath('decision-engine', 'decision-report.json')));
  modules.push(await runMeasured('final-shopping-list', 'Final Shopping List', () => produceFinalShoppingList(), previousReport, path.join(orchestratorArtifactRoot, 'final-shopping-list.json')));

  const finalReport = { orchestrator: '50toc-orchestrator-v1', startedAt, completedAt: nowIso(), elapsedMs: elapsedMs(started), status: modules.some((module) => module.status === 'FAIL') ? 'FAIL' : 'PASS', modules, outputs: { executionLog: toProjectRelativePath(executionLogPath), finalRunReport: toProjectRelativePath(finalRunReportPath), finalShoppingList: toProjectRelativePath(path.join(orchestratorArtifactRoot, 'final-shopping-list.json')) } };
  await writeFile(executionLogPath, JSON.stringify({ ...finalReport, kind: 'execution-log' }, null, 2));
  await writeFile(finalRunReportPath, JSON.stringify(finalReport, null, 2));
  return finalReport;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await runOrchestrator();
  for (const module of report.modules) console.log(`${module.name}: ${module.status} (${module.elapsedMs}ms)${module.skipped ? ' SKIPPED' : ''}`);
  console.log(`50TOC Orchestrator v1 ${report.status}: ${report.outputs.finalRunReport}`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
