import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as runMainBuyingEngineModule, defaultConnectorRegistry, resolveArtifactPath, toProjectRelativePath } from '../main/run-main-buying-engine.mjs';
import { run as runAmazonProductDiscoveryModule } from '../shared/amazon-product-discovery.mjs';
import { run as runDecisionEngineModule } from '../decision-engine/decision-engine.mjs';
import { produceFinalShoppingList } from './final-shopping-list.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const orchestratorArtifactRoot = path.join(repositoryRoot, 'artifacts', 'orchestrator');
export const finalRunReportPath = path.join(orchestratorArtifactRoot, 'final-run-report.json');
export const executionLogPath = path.join(orchestratorArtifactRoot, 'execution-log.json');
export const moduleExecutionReportPath = path.join(orchestratorArtifactRoot, 'module-execution-report.json');

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
  return { ...previous, status: previous.status === 'PASS' ? 'WARNING' : previous.status, warnings: [...(previous.warnings ?? []), 'previous successful completion'], skipped: true, skipReason: 'previous successful completion', rerun: false };
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
async function runMeasured(id, name, work, previousReport, outputPath, inputFile = null) {
  const previous = previousPass(previousReport, id);
  if (previous && (!outputPath || existsSync(outputPath))) return skippedFromPrevious(previous);
  const result = await work();
  if (result?.status && result?.startedAt && result?.completedAt) {
    return { id, name, ...result, elapsedMs: result.durationMs, outputPath: result.outputFile ?? (outputPath ? toProjectRelativePath(outputPath) : undefined), inputFile };
  }
  const at = nowIso();
  return { id, name, status: 'PASS', startedAt: at, completedAt: at, durationMs: 0, elapsedMs: 0, inputFile, outputFile: outputPath ? toProjectRelativePath(outputPath) : null, outputPath: outputPath ? toProjectRelativePath(outputPath) : undefined, processedItems: Array.isArray(result?.items) ? result.items.length : Number(result?.products ?? 0), warnings: [], errors: [], result };
}
async function runConnectorModule(connector, previousReport, { env = process.env, commandRunner = runCommand } = {}) {
  const id = `connector:${connector.id}`;
  const enabled = enabledByEnv(connector, env);
  if (!enabled) {
    const at = nowIso();
    return { id, name: connector.name, status: 'WARNING', startedAt: at, completedAt: at, durationMs: 0, elapsedMs: 0, inputFile: null, outputFile: toProjectRelativePath(connector.outputPath), processedItems: 0, warnings: ['disabled'], errors: [], skipped: true, skipReason: 'disabled' };
  }
  const previous = previousPass(previousReport, id);
  if (previous && existsSync(connector.outputPath)) return skippedFromPrevious(previous);
  const startedAt = nowIso();
  const result = await commandRunner(connector.command, connector.args, { env });
  const errors = result.ok ? [] : [result.error ?? `exit ${result.code}`];
  const standardized = { id, name: connector.name, status: result.ok ? 'PASS' : 'FAIL', startedAt, completedAt: nowIso(), durationMs: result.elapsedMs, elapsedMs: result.elapsedMs, inputFile: null, outputFile: toProjectRelativePath(connector.outputPath), outputPath: toProjectRelativePath(connector.outputPath), processedItems: 0, warnings: [], errors, command: [connector.command, ...connector.args].join(' '), exitCode: result.code };
  await mkdir(path.dirname(path.join(orchestratorArtifactRoot, `${connector.id}-execution-log.json`)), { recursive: true });
  await writeFile(path.join(orchestratorArtifactRoot, `${connector.id}-execution-log.json`), JSON.stringify({ moduleResult: standardized, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }, null, 2));
  await writeFile(path.join(orchestratorArtifactRoot, `${connector.id}-execution-report.json`), JSON.stringify(standardized, null, 2));
  return standardized;
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
    const result = await runMainBuyingEngineModule({ connectors });
    return result;
  }, previousReport, resolveArtifactPath('main', 'final-shopping-list.json')));

  modules.push(await runMeasured('amazon-product-discovery', 'Amazon Product Discovery', () => runAmazonProductDiscoveryModule(), previousReport, resolveArtifactPath('amazon', 'product-discovery.json')));
  modules.push(await runMeasured('revseller-reader', 'Revseller Reader', () => commandRunner('npm', ['run', 'read:revseller'], { env }).then((result) => { if (!result.ok) throw new Error(result.error ?? `exit ${result.code}`); return { exitCode: result.code }; }), previousReport, resolveArtifactPath('revseller', 'revseller-analysis-report.json')));
  modules.push(await runMeasured('decision-engine', 'Decision Engine', () => runDecisionEngineModule(), previousReport, resolveArtifactPath('decision-engine', 'decision-report.json')));
  modules.push(await runMeasured('final-shopping-list', 'Final Shopping List', () => produceFinalShoppingList(), previousReport, path.join(orchestratorArtifactRoot, 'final-shopping-list.json')));

  const completedAt = nowIso();
  const warnings = modules.flatMap((module) => module.warnings ?? []);
  const errors = modules.flatMap((module) => module.errors ?? (module.error ? [module.error] : []));
  const finalReport = { orchestrator: '50toc-orchestrator-v1', status: errors.length ? 'FAIL' : warnings.length ? 'WARNING' : 'PASS', startedAt, completedAt, durationMs: elapsedMs(started), elapsedMs: elapsedMs(started), inputFile: null, outputFile: toProjectRelativePath(finalRunReportPath), processedItems: modules.reduce((sum, module) => sum + Number(module.processedItems ?? 0), 0), warnings, errors, modules, outputs: { executionLog: toProjectRelativePath(executionLogPath), finalRunReport: toProjectRelativePath(finalRunReportPath), finalShoppingList: toProjectRelativePath(path.join(orchestratorArtifactRoot, 'final-shopping-list.json')) } };
  await writeFile(executionLogPath, JSON.stringify({ ...finalReport, kind: 'execution-log' }, null, 2));
  await writeFile(finalRunReportPath, JSON.stringify(finalReport, null, 2));
  await writeFile(moduleExecutionReportPath, JSON.stringify(finalReport, null, 2));
  return finalReport;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const report = await runOrchestrator();
  for (const module of report.modules) console.log(`${module.name}: ${module.status} (${module.elapsedMs}ms)${module.skipped ? ' SKIPPED' : ''}`);
  console.log(`50TOC Orchestrator v1 ${report.status}: ${report.outputs.finalRunReport}`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}
