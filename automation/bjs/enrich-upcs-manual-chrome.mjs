import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractGtinCandidatesFromObject,
  extractGtinCandidatesNearIdentity,
  extractLabeledGtinCandidates,
  normalizeGtin
} from './upc-utils.mjs';

const automationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(automationDir, '../..');
const logDir = path.join(repoRoot, 'artifacts', 'bjs', 'logs');
const productsPath = path.join(logDir, 'deal-products.json');
const progressPath = path.join(logDir, 'upc-enrichment-progress.json');
const reportPath = path.join(logDir, 'upc-enrichment-report.json');
const cdpEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const maxProducts = Number(process.env.BJS_UPC_MAX_PRODUCTS ?? 20);
const delayMs = Number(process.env.BJS_UPC_DELAY_MS ?? 2_000);
const retryNotFound = process.env.BJS_UPC_RETRY_NOT_FOUND === '1';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const keyFor = (product) => product.productIdentity || (product.sku ? `sku:${product.sku}` : product.productUrl);

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await rename(temporaryPath, filePath);
}

function productJsonCandidates(jsonLd, product) {
  const parsed = jsonLd.flatMap((text) => {
    try { return [JSON.parse(text)].flat(Infinity); } catch { return []; }
  }).filter((entry) => entry && typeof entry === 'object');

  const products = parsed.filter((entry) => /Product/i.test(String(entry['@type'] ?? '')));
  const matching = products.filter((entry) => {
    const skuMatches = product.sku && String(entry.sku ?? '') === String(product.sku);
    const nameMatches = product.productName && String(entry.name ?? '').toLowerCase().includes(String(product.productName).toLowerCase());
    return skuMatches || nameMatches;
  });
  return extractGtinCandidatesFromObject(matching.length ? matching : products.slice(0, 1));
}

async function collectDomCandidates(page, product) {
  const payload = await page.evaluate(({ sku }) => {
    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => node.textContent || '');
    const relevantScripts = [...document.scripts]
      .map((node) => node.textContent || '')
      .filter((text) => /gtin|upc|ean|barcode/i.test(text) && (!sku || text.includes(String(sku))))
      .slice(0, 20)
      .map((text) => text.slice(0, 250_000));
    const metaValues = [...document.querySelectorAll('meta[itemprop*="gtin" i], meta[itemprop*="upc" i], meta[property*="upc" i], [data-upc], [data-gtin]')]
      .flatMap((node) => [node.getAttribute('content'), node.getAttribute('data-upc'), node.getAttribute('data-gtin')])
      .filter(Boolean);
    return {
      title: document.title,
      bodyText: (document.body?.innerText || '').slice(0, 750_000),
      jsonLd,
      relevantScripts,
      metaValues
    };
  }, { sku: product.sku ?? null });

  if (/access\s+denied/i.test(`${payload.title}\n${payload.bodyText}`)) {
    const error = new Error(`BJ's Access Denied detected on ${product.productUrl}`);
    error.code = 'BJS_ACCESS_DENIED';
    throw error;
  }

  const identities = [product.sku, product.productName];
  const candidates = [
    ...productJsonCandidates(payload.jsonLd, product),
    ...payload.metaValues.map(normalizeGtin).filter(Boolean),
    ...extractLabeledGtinCandidates(payload.bodyText),
    ...payload.relevantScripts.flatMap((text) => extractGtinCandidatesNearIdentity(text, identities))
  ];
  return [...new Set(candidates)];
}

async function main() {
  const products = await readJson(productsPath, []);
  if (!Array.isArray(products)) throw new Error("BJ's deal-products.json must contain an array.");
  const progress = await readJson(progressPath, { generatedAt: null, products: {} });
  progress.products ||= {};

  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages().find((candidate) => /bjs\.com/i.test(candidate.url())) ?? await context.newPage();

  let activeCapture = null;
  page.on('response', (response) => {
    if (!activeCapture || !/bjs\.com/i.test(response.url())) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!/json|javascript|text/i.test(contentType)) return;
    const capture = activeCapture;
    const task = response.text()
      .then((text) => { if (text.length <= 3_000_000) capture.texts.push(text); })
      .catch(() => undefined);
    capture.tasks.push(task);
  });

  const run = { startedAt: new Date().toISOString(), attempted: 0, found: 0, notFound: 0, ambiguous: 0, failed: 0, stoppedForAccessDenied: false, results: [] };
  const pending = products.filter((product) => {
    if (product.upc) return false;
    const prior = progress.products[keyFor(product)];
    return !prior || (retryNotFound && prior.status === 'not_found');
  }).slice(0, Math.max(0, maxProducts));

  for (const product of pending) {
    const key = keyFor(product);
    run.attempted += 1;
    activeCapture = { texts: [], tasks: [] };
    try {
      await page.goto(product.productUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await sleep(delayMs);
      await Promise.allSettled(activeCapture.tasks);
      const domCandidates = await collectDomCandidates(page, product);
      const networkCandidates = activeCapture.texts.flatMap((text) =>
        extractGtinCandidatesNearIdentity(text, [product.sku, product.productName])
      );
      const candidates = [...new Set([...domCandidates, ...networkCandidates])];
      let status = 'not_found';
      if (candidates.length === 1) {
        product.upc = candidates[0];
        status = 'found';
        run.found += 1;
      } else if (candidates.length > 1) {
        status = 'ambiguous';
        run.ambiguous += 1;
      } else {
        run.notFound += 1;
      }
      const result = { key, sku: product.sku ?? null, productName: product.productName, productUrl: product.productUrl, status, candidates };
      progress.products[key] = { ...result, checkedAt: new Date().toISOString() };
      run.results.push(result);
      await writeJsonAtomic(productsPath, products);
      await writeJsonAtomic(progressPath, { generatedAt: new Date().toISOString(), products: progress.products });
      console.log(`${run.attempted}/${pending.length} ${status}: ${product.productName}${candidates.length ? ` — ${candidates.join(', ')}` : ''}`);
    } catch (error) {
      run.failed += 1;
      run.results.push({ key, productName: product.productName, productUrl: product.productUrl, status: 'failed', error: error.message });
      if (error.code === 'BJS_ACCESS_DENIED') {
        run.stoppedForAccessDenied = true;
        console.error(error.message);
        break;
      }
      console.error(`Failed: ${product.productName} — ${error.message}`);
    } finally {
      activeCapture = null;
    }
  }

  const report = {
    ...run,
    completedAt: new Date().toISOString(),
    totalProducts: products.length,
    totalWithUpc: products.filter((product) => product.upc).length,
    remainingWithoutUpc: products.filter((product) => !product.upc).length,
    remainingUnchecked: products.filter((product) => !product.upc && !progress.products[keyFor(product)]).length
  };
  await writeJsonAtomic(reportPath, report);
  await writeJsonAtomic(progressPath, { generatedAt: new Date().toISOString(), products: progress.products });
  console.log(JSON.stringify(report, null, 2));
  process.exit(run.stoppedForAccessDenied ? 2 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
