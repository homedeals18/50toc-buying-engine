import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runOrchestrator, finalRunReportPath, connectorModules, repositoryRoot } from './orchestrator.mjs';

const artifactPaths = [
  'artifacts/orchestrator',
  'artifacts/bjs/logs',
  'artifacts/costco_business_center/logs',
  'artifacts/sams_club/logs',
  'artifacts/main',
  'artifacts/amazon',
  'artifacts/revseller',
  'artifacts/decision-engine'
].map((entry) => path.join(repositoryRoot, entry));

const filesToRestore = [
  'artifacts/amazon/.gitkeep',
  'artifacts/amazon/product-discovery.json',
  'artifacts/main/final-shopping-list.json',
  'artifacts/main/final-execution-report.json',
  'artifacts/decision-engine/decision-report.json',
  'artifacts/revseller/revseller-analysis-report.json'
].map((entry) => path.join(repositoryRoot, entry));
const originalFiles = new Map();
for (const file of filesToRestore) {
  try { originalFiles.set(file, await readFile(file)); } catch { originalFiles.set(file, null); }
}

afterEach(async () => {
  await rm(path.join(repositoryRoot, 'artifacts', 'orchestrator'), { recursive: true, force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'costco_business_center', 'logs'), { recursive: true, force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'sams_club'), { recursive: true, force: true });
  for (const [file, content] of originalFiles) {
    if (content === null) {
      await rm(file, { force: true });
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  }
});

async function resetArtifacts() {
  await rm(path.join(repositoryRoot, 'artifacts', 'orchestrator'), { recursive: true, force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'main'), { recursive: true, force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'amazon'), { recursive: true, force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'revseller', 'revseller-analysis-report.json'), { force: true });
  await rm(path.join(repositoryRoot, 'artifacts', 'decision-engine'), { recursive: true, force: true });
  for (const dir of artifactPaths) await mkdir(dir, { recursive: true });
}

async function writeConnectorProducts(connectorId, products) {
  const filePath = path.join(repositoryRoot, 'artifacts', connectorId, 'logs', 'deal-products.json');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(products, null, 2));
}

async function writeRevsellerReport() {
  await mkdir(path.join(repositoryRoot, 'artifacts', 'revseller'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'artifacts', 'revseller', 'revseller-analysis-report.json'), JSON.stringify({ analyses: [{ asin: 'B000000001', roi: '75%', estimatedProfit: '$10.00', bsr: '1000' }] }, null, 2));
}

test('orchestrator continues when one connector fails and writes final report', async () => {
  await resetArtifacts();
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    const script = args.join(' ');
    if (script.includes('bjs')) {
      await writeConnectorProducts('bjs', [{ upc: '1', brand: 'Acme', productName: 'Widget', packageSize: '1 ct', currentPrice: '$5.00' }]);
      return { ok: true, code: 0, elapsedMs: 3 };
    }
    if (script.includes('costco')) return { ok: false, code: 2, elapsedMs: 4 };
    if (script.includes('sams')) {
      await writeConnectorProducts('sams_club', [{ upc: '1', brand: 'Acme', productName: 'Widget', packageSize: '1 ct', currentPrice: '$4.50' }]);
      return { ok: true, code: 0, elapsedMs: 5 };
    }
    if (script.includes('read:revseller')) {
      await writeRevsellerReport();
      return { ok: true, code: 0, elapsedMs: 6 };
    }
    return { ok: true, code: 0, elapsedMs: 1 };
  };

  const report = await runOrchestrator({ commandRunner, env: { AMAZON_BROWSER_HEADLESS: 'true' } });

  assert.equal(report.orchestrator, '50toc-orchestrator-v1');
  assert.equal(report.modules.find((entry) => entry.id === 'connector:costco_business_center').status, 'FAIL');
  assert.equal(report.modules.find((entry) => entry.id === 'main-buying-engine').status, 'PASS');
  assert.equal(report.modules.find((entry) => entry.id === 'final-shopping-list').status, 'PASS');
  assert.ok(report.modules.every((entry) => Number.isFinite(entry.elapsedMs)));
  assert.ok(calls.some((call) => call.includes('costco')));
  assert.ok(await import('node:fs').then((fs) => fs.existsSync(finalRunReportPath)));
});

test('orchestrator does not rerun previous successful connector steps', async () => {
  await resetArtifacts();
  for (const connector of connectorModules) await writeConnectorProducts(connector.id, []);
  await writeFile(finalRunReportPath, JSON.stringify({ modules: connectorModules.map((connector) => ({ id: `connector:${connector.id}`, name: connector.name, status: 'PASS', elapsedMs: 1 })) }, null, 2));
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args.join(' ').includes('read:revseller')) {
      await writeRevsellerReport();
      return { ok: true, code: 0, elapsedMs: 1 };
    }
    return { ok: true, code: 0, elapsedMs: 1 };
  };

  const report = await runOrchestrator({ commandRunner, env: { AMAZON_BROWSER_HEADLESS: 'true' } });
  assert.equal(report.modules.filter((entry) => entry.id.startsWith('connector:') && entry.skipped).length, connectorModules.length);
  assert.ok(!calls.some((call) => call.includes('scrape:')));
});
