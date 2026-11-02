import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const automationDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(automationDir, '../..');
const outputPath = path.join(repoRoot, 'artifacts', 'bjs', 'logs', 'listing-network-diagnostic.json');
const cdpEndpoint = process.env.BJS_CHROME_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const settleMs = Number(process.env.BJS_NETWORK_DIAGNOSTIC_SETTLE_MS ?? 5_000);
const sources = [
  { name: 'Clearance', url: 'https://www.bjs.com/category/clearance/' },
  { name: 'Wow Deals', url: 'https://www.bjs.com/category/deals/wow-deals/' }
];

const signalPatterns = {
  productName: /(?:^|_)(?:name|title|productname|displayname)$/i,
  price: /price|amount|savings|discount/i,
  upcGtin: /upc|gtin|ean|barcode/i,
  pagination: /total|count|pagesize|page|offset|cursor|hasnext/i,
  club: /club|location|store|pickup|inventory|availability/i,
  productIdentity: /productid|product_id|itemid|item_id|sku|producturl|product_url/i
};

function objectKeys(value, results = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return results;
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 50)) objectKeys(entry, results, depth + 1);
    return results;
  }
  for (const [key, entry] of Object.entries(value)) {
    results.add(key);
    objectKeys(entry, results, depth + 1);
  }
  return results;
}

function looksLikeProduct(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = [...objectKeys(value, new Set(), 7)];
  const hasIdentity = keys.some((key) => signalPatterns.productIdentity.test(key));
  const hasName = keys.some((key) => signalPatterns.productName.test(key));
  const hasPrice = keys.some((key) => signalPatterns.price.test(key));
  return hasIdentity && (hasName || hasPrice);
}

function findProductArrays(value, location = '$', results = [], depth = 0) {
  if (!value || typeof value !== 'object' || depth > 10) return results;
  if (Array.isArray(value)) {
    const objects = value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    const productCount = objects.filter(looksLikeProduct).length;
    if (productCount > 0) {
      const keys = [...objectKeys(objects.slice(0, 20))].sort();
      results.push({
        path: location,
        arrayLength: value.length,
        productLikeObjects: productCount,
        fields: Object.fromEntries(Object.entries(signalPatterns).map(([name, pattern]) => [name, keys.filter((key) => pattern.test(key))])),
        observedKeys: keys.slice(0, 100)
      });
    }
    value.slice(0, 100).forEach((entry, index) => findProductArrays(entry, `${location}[${index}]`, results, depth + 1));
    return results;
  }
  for (const [key, entry] of Object.entries(value)) findProductArrays(entry, `${location}.${key}`, results, depth + 1);
  return results;
}

export function analyzeJson(value) {
  const arrays = findProductArrays(value);
  const keys = [...objectKeys(value)].sort();
  return {
    productArrays: arrays,
    fields: Object.fromEntries(Object.entries(signalPatterns).map(([name, pattern]) => [name, keys.filter((key) => pattern.test(key))]))
  };
}

async function pageSnapshot(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText ?? '';
    const total = Number(bodyText.match(/\((\d+)\s+Results\)|Showing\s+\d+\s+of\s+(\d+)\s+Results/i)?.slice(1).find(Boolean) ?? 0) || null;
    const productUrls = new Set([...document.querySelectorAll('a[href*="/product/"]')].map((link) => link.href.split(/[?#]/)[0]));
    const embedded = [...document.querySelectorAll('script')].flatMap((node, index) => {
      const text = (node.textContent ?? '').trim();
      if (!text || (!text.startsWith('{') && !text.startsWith('['))) return [];
      try { return [{ index, type: node.type || null, value: JSON.parse(text) }]; } catch { return []; }
    });
    return { title: document.title, url: location.href, accessDenied: /access\s+denied/i.test(`${document.title}\n${bodyText}`), visibleResultTotal: total, renderedProductLinkCount: productUrls.size, embedded };
  });
}

async function inspectSource(page, source) {
  const responseTasks = [];
  const onResponse = (response) => {
    const contentType = response.headers()['content-type'] ?? '';
    if (!/json/i.test(contentType)) return;
    responseTasks.push((async () => {
      try {
        const value = await response.json();
        const analysis = analyzeJson(value);
        if (!analysis.productArrays.length) return null;
        return { url: response.url(), status: response.status(), resourceType: response.request().resourceType(), contentType, ...analysis };
      } catch { return null; }
    })());
  };

  page.on('response', onResponse);
  try {
    await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(settleMs);
    const snapshot = await pageSnapshot(page);
    if (snapshot.accessDenied) throw new Error(`BJ's Access Denied detected at ${snapshot.url}; diagnostic stopped without retrying.`);
    const responses = (await Promise.all(responseTasks)).filter(Boolean);
    const embeddedData = snapshot.embedded.map(({ index, type, value }) => ({ index, type, ...analyzeJson(value) })).filter((entry) => entry.productArrays.length);
    delete snapshot.embedded;
    return { source: source.name, requestedUrl: source.url, ...snapshot, responses, embeddedData };
  } finally {
    page.off('response', onResponse);
  }
}

function fieldSummary(results, field) {
  const candidates = results.flatMap((result) => [...result.responses, ...result.embeddedData]);
  const matches = candidates.flatMap((entry) => [
    ...(entry.fields[field] ?? []),
    ...entry.productArrays.flatMap((array) => array.fields[field] ?? [])
  ]);
  return { verified: matches.length > 0, observedKeys: [...new Set(matches)].sort() };
}

async function main() {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome has no browser context. Open BJ\'s in the Chrome window and try again.');
  const page = context.pages().find((candidate) => /bjs\.com/i.test(candidate.url())) ?? await context.newPage();
  const results = [];
  for (const source of sources) results.push(await inspectSource(page, source));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only passive browser response inspection',
    safety: { replayedRequests: false, bypassedAccessControls: false, commerceActions: false },
    endpoint: cdpEndpoint,
    results,
    verifiedFields: Object.fromEntries(Object.keys(signalPatterns).map((field) => [field, fieldSummary(results, field)])),
    countComparison: results.map((result) => ({ source: result.source, visibleResultTotal: result.visibleResultTotal, renderedProductLinkCount: result.renderedProductLinkCount, largestJsonProductArray: Math.max(0, ...result.responses.flatMap((entry) => entry.productArrays.map((array) => array.arrayLength)), ...result.embeddedData.flatMap((entry) => entry.productArrays.map((array) => array.arrayLength))) }))
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputPath, verifiedFields: report.verifiedFields, countComparison: report.countComparison, candidateResponses: results.reduce((sum, result) => sum + result.responses.length + result.embeddedData.length, 0) }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
}
