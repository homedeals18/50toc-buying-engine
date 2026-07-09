import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from './connector-config.mjs';
import { confidenceRules, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

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
  if (product?.amazonUrl) return product.amazonUrl;
  if (product?.url && /amazon\.com/i.test(product.url)) return product.url;
  if (product?.asin || product?.amazonAsin) return product.asin || product.amazonAsin;
  if (product?.upc) return product.upc;
  return [product?.brand, product?.productName, product?.packageSize, product?.count].filter(Boolean).join(' ');
}

export function extractAmazonProductFromPage(pageData) {
  return {
    asin: pageData.asin,
    title: pageData.title,
    productName: pageData.title,
    brand: pageData.brand,
    upc: pageData.upc,
    packageSize: pageData.packageSize,
    count: pageData.count,
    currentSellingPrice: pageData.price,
    productUrl: pageData.productUrl
  };
}

export async function readAmazonProductPageData(page) {
  return page.evaluate(() => {
    const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
    const text = clean(document.body?.innerText) || '';
    const bySelector = (selector) => clean(document.querySelector(selector)?.textContent);
    const asin = location.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('[name="ASIN"]')?.value || null;
    const title = bySelector('#productTitle') || clean(document.title?.replace(/Amazon.com\s*:?\s*/i, ''));
    const brand = bySelector('#bylineInfo')?.replace(/^Brand:\s*/i, '').replace(/^Visit the\s+/i, '').replace(/\s+Store$/i, '') || null;
    const price = bySelector('.a-price .a-offscreen, #corePriceDisplay_desktop_feature_div .a-offscreen, #priceblock_ourprice, #priceblock_dealprice');
    const upc = text.match(/\b(?:UPC|GTIN|EAN)\s*[:#-]?\s*([0-9-]{8,14})\b/i)?.[1] || null;
    const packageSize = text.match(/\b\d+(?:\.\d+)?\s*(?:oz|ounce|ounces|fl oz|ct|count|pack|pk|lb|lbs|gallon|gal|qt)\b(?:\s*[xX]\s*\d+)?/i)?.[0] || null;
    const count = text.match(/\b\d+\s*(?:ct|count|pack|pk)\b/i)?.[0] || null;
    return { asin, title, brand, price, upc, packageSize, count, productUrl: location.href };
  });
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

export async function openConfidentAmazonMatch(page, product) {
  await openAmazonMatch(page, product);
  const pageData = await readAmazonProductPageData(page);
  const match = matchProductToAmazon(product, [extractAmazonProductFromPage(pageData)]);
  const matched = match.confidenceScore >= confidenceRules.brandName;
  return {
    status: matched ? 'matched' : 'needs_review',
    needsReview: !matched,
    revsellerEligible: matched,
    match: { ...match, amazonProductUrl: pageData.productUrl },
    amazonPageData: pageData
  };
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
