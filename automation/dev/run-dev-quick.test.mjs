import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateQuickArtifact, validateQuickArtifacts } from './run-dev-quick.mjs';

test('validateQuickArtifact warns when an optional artifact is missing', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-quick-missing-'));
  const missingPath = path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json');

  try {
    const result = await validateQuickArtifact("BJ's deal-products.json", missingPath, { requireArray: true });

    assert.equal(result.status, 'WARN');
    assert.equal(result.count, null);
    assert.match(result.warning, /Missing /);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('validateQuickArtifacts reads only the requested fast validation artifacts', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-quick-artifacts-'));
  const artifacts = {
    bjsDealProducts: path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json'),
    costcoDealProducts: path.join(tempRoot, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json'),
    finalShoppingList: path.join(tempRoot, 'artifacts', 'main', 'final-shopping-list.json'),
    finalExecutionReport: path.join(tempRoot, 'artifacts', 'main', 'final-execution-report.json')
  };

  try {
    await Promise.all(Object.values(artifacts).map((file) => mkdir(path.dirname(file), { recursive: true })));
    await writeFile(artifacts.bjsDealProducts, JSON.stringify([{ productName: 'BJ Product' }, { productName: 'Second BJ Product' }]));
    await writeFile(artifacts.costcoDealProducts, JSON.stringify([{ productName: 'Costco Product' }]));
    await writeFile(artifacts.finalShoppingList, JSON.stringify([{ productName: 'Final Product' }]));
    await writeFile(artifacts.finalExecutionReport, JSON.stringify({ pipeline: 'main-buying-engine' }));

    const ignoredInvalidJson = path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'ignored-playwright-results.json');
    await writeFile(ignoredInvalidJson, '{ invalid json');

    const result = await validateQuickArtifacts(artifacts);

    assert.equal(existsSync(ignoredInvalidJson), true);
    assert.equal(result.bjsDealProducts.status, 'PASS');
    assert.equal(result.bjsDealProducts.count, 2);
    assert.equal(result.costcoDealProducts.count, 1);
    assert.equal(result.finalShoppingList.count, 1);
    assert.equal(result.finalExecutionReport.status, 'PASS');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('validateQuickArtifact fails when an array artifact is not an array', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-quick-array-'));
  const filePath = path.join(tempRoot, 'artifacts', 'main', 'final-shopping-list.json');

  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ productName: 'Not an array' }));

    const result = await validateQuickArtifact('Main final-shopping-list.json', filePath, { requireArray: true });

    assert.equal(result.status, 'FAIL');
    assert.match(result.error, /expected a JSON array/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
