import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConnectorRegistry, resolveArtifactPath, runMainBuyingEngine, toProjectRelativePath } from '../main/run-main-buying-engine.mjs';

const startedAt = Date.now();
const supportsColor = process.env.NO_COLOR === undefined && (process.stdout.isTTY || process.env.FORCE_COLOR);
const color = (code, value) => supportsColor ? `\u001b[${code}m${value}\u001b[0m` : value;
const green = (value) => color(32, value);
const yellow = (value) => color(33, value);
const red = (value) => color(31, value);
const cyan = (value) => color(36, value);

export const quickValidationArtifacts = {
  bjsDealProducts: resolveArtifactPath('bjs', 'logs', 'deal-products.json'),
  costcoDealProducts: resolveArtifactPath('costco_business_center', 'logs', 'deal-products.json'),
  finalShoppingList: resolveArtifactPath('main', 'final-shopping-list.json'),
  finalExecutionReport: resolveArtifactPath('main', 'final-execution-report.json')
};

function formatStatus(status) {
  if (status === 'PASS') return green(status);
  if (status === 'FAIL') return red(status);
  return yellow(status);
}

function printSummaryLine(label, status, detail = '') {
  const dotted = `${label} ${'.'.repeat(Math.max(1, 28 - label.length))}`;
  console.log(`${dotted} ${formatStatus(status)}${detail ? ` ${detail}` : ''}`);
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return { exists: false, parsed: null, error: null };
  try {
    return { exists: true, parsed: JSON.parse(await readFile(filePath, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, parsed: null, error };
  }
}

function countArray(parsed) {
  return Array.isArray(parsed) ? parsed.length : null;
}

export async function validateQuickArtifact(label, filePath, { requireArray = false } = {}) {
  const result = await readJsonIfExists(filePath);
  const relativePath = toProjectRelativePath(filePath);

  if (!result.exists) {
    return {
      label,
      filePath,
      relativePath,
      status: 'WARN',
      count: null,
      warning: `Missing ${relativePath}`,
      message: 'missing'
    };
  }

  if (result.error) {
    return {
      label,
      filePath,
      relativePath,
      status: 'FAIL',
      count: null,
      error: `${relativePath}: ${result.error.message}`,
      message: 'invalid JSON'
    };
  }

  const count = countArray(result.parsed);
  if (requireArray && count === null) {
    return {
      label,
      filePath,
      relativePath,
      status: 'FAIL',
      count: null,
      error: `${relativePath}: expected a JSON array`,
      message: 'not an array'
    };
  }

  return {
    label,
    filePath,
    relativePath,
    status: 'PASS',
    count,
    error: null,
    warning: null,
    message: count === null ? 'valid JSON' : `${count} products`
  };
}

export async function validateQuickArtifacts(artifacts = quickValidationArtifacts) {
  return {
    bjsDealProducts: await validateQuickArtifact("BJ's deal-products.json", artifacts.bjsDealProducts, { requireArray: true }),
    costcoDealProducts: await validateQuickArtifact('Costco deal-products.json', artifacts.costcoDealProducts, { requireArray: true }),
    finalShoppingList: await validateQuickArtifact('Main final-shopping-list.json', artifacts.finalShoppingList, { requireArray: true }),
    finalExecutionReport: await validateQuickArtifact('Main final-execution-report.json', artifacts.finalExecutionReport)
  };
}

function connectorRegistryFromExistingArtifacts(artifacts = quickValidationArtifacts) {
  return defaultConnectorRegistry.map((connector) => {
    if (connector.id === 'bjs') return { ...connector, enabled: existsSync(artifacts.bjsDealProducts), dealProductsPath: artifacts.bjsDealProducts };
    if (connector.id === 'costco_business_center') return { ...connector, enabled: existsSync(artifacts.costcoDealProducts), dealProductsPath: artifacts.costcoDealProducts };
    return { ...connector, enabled: false };
  });
}

export async function runDevQuick() {
  console.log(cyan('[dev:quick] Fast local validation mode. Reading existing artifacts only; no scrapers, browsers, carts, checkout, or purchase.'));

  const beforeValidation = await validateQuickArtifacts();
  const failures = Object.values(beforeValidation).filter((artifact) => artifact.status === 'FAIL');
  if (failures.length) {
    for (const failure of failures) console.error(`[dev:quick] Invalid artifact: ${failure.error}`);
    process.exitCode = 1;
    return { beforeValidation, afterValidation: beforeValidation, finalProducts: [], report: null, durationMs: Date.now() - startedAt };
  }

  console.log(cyan('[dev:quick] Running Main Buying Engine from existing deal-products artifacts...'));
  const { finalProducts, report } = await runMainBuyingEngine(connectorRegistryFromExistingArtifacts());
  const afterValidation = await validateQuickArtifacts();
  const afterFailures = Object.values(afterValidation).filter((artifact) => artifact.status === 'FAIL');
  const missingWarnings = Object.values(beforeValidation).filter((artifact) => artifact.status === 'WARN');
  const durationMs = Date.now() - startedAt;

  console.log('\n====================================');
  console.log('dev:quick summary');
  console.log('====================================');
  printSummaryLine("BJ's products", beforeValidation.bjsDealProducts.status === 'FAIL' ? 'FAIL' : 'PASS', `(${beforeValidation.bjsDealProducts.count ?? 0})`);
  printSummaryLine('Costco products', beforeValidation.costcoDealProducts.status === 'FAIL' ? 'FAIL' : 'PASS', `(${beforeValidation.costcoDealProducts.count ?? 0})`);
  printSummaryLine('Final shopping list', afterValidation.finalShoppingList.status, `(${afterValidation.finalShoppingList.count ?? finalProducts.length})`);
  printSummaryLine('Execution report', afterValidation.finalExecutionReport.status, `(${toProjectRelativePath(quickValidationArtifacts.finalExecutionReport)})`);
  printSummaryLine('Duration', durationMs < 10_000 ? 'PASS' : 'FAIL', `(${(durationMs / 1000).toFixed(2)}s)`);

  if (missingWarnings.length) {
    console.log('\nMissing files warnings:');
    for (const warning of missingWarnings) console.log(`- ${warning.warning}`);
  } else {
    console.log('\nMissing files warnings: none');
  }

  if (afterFailures.length) {
    console.log('\nInvalid JSON files after Main Buying Engine:');
    for (const failure of afterFailures) console.log(`- ${failure.error}`);
  }

  console.log('====================================');
  console.log(afterFailures.length || durationMs >= 10_000 ? red('Finished With Failure') : green(`Finished Successfully (${report.totals.loadedProducts} loaded offers)`));
  console.log('====================================');

  process.exitCode = afterFailures.length || durationMs >= 10_000 ? 1 : 0;
  return { beforeValidation, afterValidation, finalProducts, report, durationMs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runDevQuick();
}
