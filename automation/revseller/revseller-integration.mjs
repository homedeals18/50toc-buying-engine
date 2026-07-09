import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from './connector-config.mjs';

export const amazonAnalysisReportPath = path.resolve(process.cwd(), '../../artifacts/amazon/revseller-analysis-report.json');

export function parseMoney(value) {
  const match = String(value ?? '').match(/-?\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function parsePercent(value) {
  const match = String(value ?? '').match(/-?\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

function valueAfterLabel(text, labelPattern) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  const match = source.match(new RegExp(`${labelPattern}\\s*:?\\s*([^|•\\n]+?)(?=\\s+(?:ASIN|Product Title|Title|Current Amazon Price|Amazon Price|Price|FBA Fees?|Fees?|Estimated Profit|Profit|ROI|BSR|Rank|Category|Hazmat|Meltable|IP Alert|Variation)\\b|$)`, 'i'));
  return match?.[1]?.trim() || null;
}

export function extractRevsellerFields({ panelText, asin, productTitle, productUrl }) {
  const text = String(panelText ?? '');
  const extractedAsin = valueAfterLabel(text, 'ASIN') || text.match(/\b[A-Z0-9]{10}\b/)?.[0] || asin || null;
  const priceText = valueAfterLabel(text, '(?:Current Amazon Price|Amazon Price|Price)');
  const feeText = valueAfterLabel(text, '(?:FBA Fees?|Fees?)');
  const profitText = valueAfterLabel(text, '(?:Estimated Profit|Profit)');
  const roiText = valueAfterLabel(text, 'ROI');
  return {
    asin: extractedAsin,
    productTitle: valueAfterLabel(text, '(?:Product Title|Title)') || productTitle || null,
    productUrl: productUrl || null,
    currentAmazonPrice: parseMoney(priceText),
    fbaFees: parseMoney(feeText),
    estimatedProfit: parseMoney(profitText),
    roi: parsePercent(roiText),
    bsr: valueAfterLabel(text, '(?:BSR|Rank)'),
    category: valueAfterLabel(text, 'Category'),
    hazmat: valueAfterLabel(text, 'Hazmat'),
    meltable: valueAfterLabel(text, 'Meltable'),
    ipAlert: valueAfterLabel(text, 'IP Alert'),
    variation: valueAfterLabel(text, 'Variation'),
    revsellerPanelFound: Boolean(text.trim()),
    profitabilitySource: text.trim() ? 'RevSeller' : null
  };
}

export async function writeRevsellerAnalysisReport(reportPath, report, env) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const safe = JSON.parse(redactSensitiveText(JSON.stringify(report), env));
  await writeFile(reportPath, JSON.stringify(safe, null, 2));
}

export async function readConnectorProductsFromJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.products ?? parsed.items ?? [];
}

export function amazonMatchQuery(product) {
  return product?.amazonUrl || product?.productUrl || product?.url || product?.asin || product?.upc || [product?.brand, product?.productName, product?.packageSize].filter(Boolean).join(' ');
}

export async function openAmazonMatch(page, product) {
  const query = amazonMatchQuery(product);
  if (!query) throw new Error('Connector product has no Amazon match query fields.');
  if (/^https?:\/\//i.test(query)) {
    await page.goto(query, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    return page.url();
  }
  const isAsin = /^[A-Z0-9]{10}$/i.test(query.trim());
  const url = isAsin ? `https://www.amazon.com/dp/${encodeURIComponent(query.trim())}` : `https://www.amazon.com/s?k=${encodeURIComponent(query.trim())}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!isAsin) {
    const firstProduct = page.locator('[data-component-type="s-search-result"] h2 a, [data-asin] h2 a').first();
    if (await firstProduct.isVisible({ timeout: 10_000 }).catch(() => false)) await firstProduct.click();
  }
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
  return page.url();
}

export async function readRevsellerPanel(page) {
  await page.waitForTimeout(5_000);
  return page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const asin = location.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('[name="ASIN"]')?.value || null;
    const productTitle = clean(document.querySelector('#productTitle')?.textContent || document.title);
    const nodes = [...document.querySelectorAll('[id*="revseller" i], [class*="revseller" i], iframe[src*="revseller" i]')];
    const panelText = clean(nodes.map((node) => node.innerText || node.textContent || node.getAttribute('src')).filter(Boolean).join(' '));
    return { asin, productTitle, productUrl: location.href, panelText };
  });
}
