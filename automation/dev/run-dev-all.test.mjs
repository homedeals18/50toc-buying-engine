import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runConnector, validateGeneratedJson } from './run-dev-all.mjs';

test("runConnector downgrades BJ's manual Chrome failures to warnings", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-all-bjs-graceful-'));
  const result = await runConnector({
    label: "BJ's",
    env: 'BJS_CONNECTOR_ENABLED_TEST_ONLY',
    defaultEnabled: true,
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    artifactPath: path.join(tempRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json'),
    gracefulFailure: true
  });

  assert.equal(result.status, 'WARN');
  assert.match(result.detail, /unavailable, exit 1/);
});

test('validateGeneratedJson only reads generated report file names', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dev-all-json-validation-'));
  const profileDir = path.join(tempRoot, 'artifacts', 'bjs', 'manual-chrome-profile', 'Default');
  const logsDir = path.join(tempRoot, 'artifacts', 'bjs', 'logs');
  await mkdir(profileDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const invalidProfileJson = path.join(profileDir, 'Preferences.json');
  const validDealProductsJson = path.join(logsDir, 'deal-products.json');
  const ignoredPlaywrightJson = path.join(logsDir, 'playwright-results.json');
  await writeFile(invalidProfileJson, '{ invalid profile json');
  await writeFile(validDealProductsJson, '[]');
  await writeFile(ignoredPlaywrightJson, '{ invalid playwright json');

  const result = await validateGeneratedJson([invalidProfileJson, validDealProductsJson, ignoredPlaywrightJson]);

  assert.equal(result.status, 'PASS');
  assert.equal(result.detail, '(1 files)');
  assert.deepEqual(result.failures, []);
});
