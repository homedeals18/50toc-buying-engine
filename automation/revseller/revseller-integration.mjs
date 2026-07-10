import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { redactSensitiveText } from './connector-config.mjs';
import { confidenceRules, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

export const amazonAnalysisReportPath = path.resolve(process.cwd(), '../../artifacts/amazon/revseller-analysis-report.json');
export const revsellerArtifactRoot = path.resolve(process.cwd(), '../../artifacts/revseller');
export const revsellerReaderReportPath = path.join(revsellerArtifactRoot, 'revseller-analysis-report.json');
export const revsellerMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.png');
export const revsellerMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.html');
export const revsellerFieldsMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.png');
export const revsellerFieldsMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.html');
export const revsellerPanelTextPath = path.join(revsellerArtifactRoot, 'revseller-panel-text.txt');

export function parseMoney(value) {
  const match = String(value ?? '').match(/-?\$?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  return match ? Number(match[1].replaceAll(',', '')) : null;
}

export function parsePercent(value) {
  const match = String(value ?? '').match(/-?\s*([0-9]+(?:\.[0-9]+)?)\s*%/);
  return match ? Number(match[1]) : null;
}

const revsellerFieldLabels = [
  'ASIN',
  'Product Title',
  'Title',
  'Selling Price',
  'Sell Price',
  'Current Amazon Price',
  'Amazon Price',
  'Price',
  'FBA Fees',
  'FBA Fee',
  'Fees',
  'Estimated Profit',
  'Est. Profit',
  'Net Profit',
  'Profit',
  'ROI',
  'BSR',
  'Best Sellers Rank',
  'Sales Rank',
  'Rank',
  'Category',
  'Hazmat',
  'Meltable',
  'IP / Restriction warnings',
  'IP Alert',
  'IP Warning',
  'Restriction warnings',
  'Restrictions',
  'Variation'
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function valueAfterLabel(text, labelPattern) {
  const source = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return null;
  const nextLabels = revsellerFieldLabels.map(escapeRegExp).join('|');
  const match = source.match(new RegExp(`(?:${labelPattern})\\s*:?\\s*([^|•\\n]+?)(?=\\s+(?:${nextLabels})\\b|$)`, 'i'));
  return match?.[1]?.trim() || null;
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value ?? '').trim()) ?? null;
}

function hasExtractedRevsellerValues(data) {
  return Boolean(data.sellingPrice || data.fbaFees || data.estimatedProfit || data.roi || data.bsr || data.category || data.hazmatWarning || data.meltableWarning || data.ipRestrictionWarnings);
}

export function extractRevsellerFields({ panelText, asin, productTitle, productUrl, fields = {}, panelFound } = {}) {
  const text = String(panelText ?? '');
  const found = panelFound ?? Boolean(text.trim() || Object.values(fields).some((value) => String(value ?? '').trim()));
  const extractedAsin = firstNonEmpty(fields.asin, valueAfterLabel(text, 'ASIN'), text.match(/\b[A-Z0-9]{10}\b/)?.[0], asin);
  const priceText = firstNonEmpty(fields.sellingPrice, fields.currentAmazonPrice, valueAfterLabel(text, '(?:Selling Price|Sell Price|Current Amazon Price|Amazon Price|Price)'));
  const feeText = firstNonEmpty(fields.fbaFees, valueAfterLabel(text, '(?:FBA Fees?|Fees?)'));
  const profitText = firstNonEmpty(fields.estimatedProfit, valueAfterLabel(text, '(?:Estimated Profit|Est\\.? Profit|Net Profit|Profit)'));
  const roiText = firstNonEmpty(fields.roi, valueAfterLabel(text, 'ROI'));
  const hazmatText = firstNonEmpty(fields.hazmatWarning, valueAfterLabel(text, 'Hazmat'));
  const meltableText = firstNonEmpty(fields.meltableWarning, valueAfterLabel(text, 'Meltable'));
  const ipText = firstNonEmpty(fields.ipRestrictionWarnings, valueAfterLabel(text, '(?:IP / Restriction warnings?|IP Alert|IP Warning|Restriction warnings?|Restrictions?)'));
  return {
    asin: extractedAsin,
    productTitle: firstNonEmpty(fields.productTitle, valueAfterLabel(text, '(?:Product Title|Title)'), productTitle),
    productUrl: productUrl || null,
    sellingPrice: priceText || null,
    currentAmazonPrice: parseMoney(priceText),
    fbaFees: feeText || null,
    estimatedProfit: profitText || null,
    roi: roiText || null,
    bsr: firstNonEmpty(fields.bsr, valueAfterLabel(text, '(?:BSR|Best Sellers Rank|Sales Rank|Rank)')),
    category: firstNonEmpty(fields.category, valueAfterLabel(text, 'Category')),
    hazmatWarning: hazmatText || null,
    meltableWarning: meltableText || null,
    ipRestrictionWarnings: ipText || null,
    hazmat: hazmatText || null,
    meltable: meltableText || null,
    ipAlert: ipText || null,
    variation: firstNonEmpty(fields.variation, valueAfterLabel(text, 'Variation')),
    revsellerPanelFound: Boolean(found),
    profitabilitySource: found ? 'RevSeller' : null
  };
}

export function revsellerFieldsFound(data) {
  return hasExtractedRevsellerValues(data);
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

function revsellerPanelBrowserReader() {
  const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
  const visibleTextNodes = (root) => {
    const nodes = [];
    const isVisibleElement = (element) => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || element.tagName === 'IFRAME';
    };
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        const text = clean(node.nodeValue);
        if (text && isVisibleElement(parent)) nodes.push(text);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
      if (node.nodeType === Node.ELEMENT_NODE && !isVisibleElement(node)) return;
      if (node.shadowRoot) visit(node.shadowRoot);
      for (const child of node.childNodes) visit(child);
    };
    visit(root);
    return nodes;
  };
  const asin = location.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('[name="ASIN"]')?.value || null;
  const productTitle = clean(document.querySelector('#productTitle')?.textContent || document.title);
  const selector = '[id*="revseller" i], [class*="revseller" i], [data-testid*="revseller" i], [aria-label*="revseller" i], iframe[src*="revseller" i], [id*="rs-" i], [class*="rs-" i]';
  const labels = ['sell price', 'selling price', 'fba fee', 'estimated profit', 'net profit', 'roi', 'bsr', 'sales rank', 'hazmat', 'meltable', 'ip alert', 'restriction'];
  const candidates = [...document.querySelectorAll(selector)];
  for (const host of document.querySelectorAll('*')) {
    if (host.shadowRoot) candidates.push(...host.shadowRoot.querySelectorAll(selector));
  }
  for (const node of [...document.querySelectorAll('aside, section, div, table')]) {
    const text = clean(node.innerText || node.textContent) || '';
    const hits = labels.filter((label) => text.toLowerCase().includes(label)).length;
    if (hits >= 3 && text.length < 12000) candidates.push(node);
  }
  const unique = [...new Set(candidates)].filter((node) => node?.isConnected);
  const scored = unique.map((node, index) => {
    const textNodes = visibleTextNodes(node);
    const text = clean(textNodes.join(' ') || node.innerText || node.textContent || node.getAttribute('src')) || '';
    const score = labels.filter((label) => text.toLowerCase().includes(label)).length + (/revseller/i.test(`${node.id} ${node.className} ${node.getAttribute?.('src') || ''}`) ? 10 : 0);
    return { node, text, textNodes, score, index, hasShadowRoot: Boolean(node.shadowRoot), isIframe: node.tagName === 'IFRAME' };
  }).filter((entry) => entry.text).sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.index - b.index);
  const panel = scored[0] || null;
  const panelNode = panel?.node || null;
  const panelText = clean(scored.map((entry) => entry.text).join(' '));
  const panelTextNodes = [...new Set(scored.flatMap((entry) => entry.textNodes))];
  const panelHtml = panelNode?.outerHTML || null;

  const fieldPatterns = {
    sellingPrice: /(?:selling|sell|amazon)\s*price/i,
    fbaFees: /(?:fba\s*fees?|fees?)/i,
    estimatedProfit: /(?:estimated|est\.?|net)?\s*profit/i,
    roi: /\broi\b/i,
    bsr: /\b(?:bsr|best sellers rank|sales rank|rank)\b/i,
    category: /category/i,
    hazmatWarning: /hazmat/i,
    meltableWarning: /meltable/i,
    ipRestrictionWarnings: /\b(?:ip|restriction|restricted)\b/i,
    variation: /variation/i
  };
  const fieldNames = Object.keys(fieldPatterns);
  const allPanelElements = panelNode ? [...panelNode.querySelectorAll('*')].sort((a, b) => (clean(a.innerText || a.textContent)?.length || 0) - (clean(b.innerText || b.textContent)?.length || 0)) : [];
  const readNearbyValue = (element, fieldName) => {
    const row = element.closest('tr, li, [role="row"], .row, [class*="row" i], [class*="line" i], div') || element;
    const rowText = clean(row.innerText || row.textContent) || '';
    const labelText = clean(element.innerText || element.textContent) || '';
    const withoutLabel = clean(rowText.replace(labelText, ''));
    const explicit = rowText.match(new RegExp(`${labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:?\\s*(.+)$`, 'i'))?.[1];
    const sibling = clean(element.nextElementSibling?.innerText || element.nextElementSibling?.textContent);
    return clean(sibling || explicit || withoutLabel || (fieldName === 'ipRestrictionWarnings' || fieldName.endsWith('Warning') ? rowText : null));
  };
  const fields = {};
  for (const fieldName of fieldNames) {
    const match = allPanelElements.find((element) => fieldPatterns[fieldName].test(clean(element.innerText || element.textContent) || ''));
    const value = match ? readNearbyValue(match, fieldName) : null;
    if (value) fields[fieldName] = value;
  }
  return { asin, productTitle, productUrl: location.href, panelText, panelTextNodes, panelHtml, fields, panelFound: Boolean(panelNode || panelText), renderContexts: scored.map(({ isIframe, hasShadowRoot, score }) => ({ isIframe, hasShadowRoot, score })) };
}

export async function readRevsellerPanel(page) {
  await page.waitForTimeout(5_000);
  const frames = typeof page.frames === 'function' ? page.frames() : [page];
  const framePanels = await Promise.all(frames.map((frame) => frame.evaluate(revsellerPanelBrowserReader).catch(() => null)));
  return framePanels.filter(Boolean).sort((a, b) => Number(Boolean(b.panelText)) - Number(Boolean(a.panelText)) || (b.panelText?.length || 0) - (a.panelText?.length || 0))[0] ?? { panelText: '', panelTextNodes: [], fields: {}, panelFound: false };
}


export const revsellerPanelSelectors = [
  '[id*="revseller" i]',
  '[class*="revseller" i]',
  '[data-testid*="revseller" i]',
  '[aria-label*="revseller" i]',
  'iframe[src*="revseller" i]',
  '[id*="rs-" i]',
  '[class*="rs-" i]'
];

export function isAmazonProductPageUrl(url) {
  return /amazon\.[a-z.]+\/(?:[^/]+\/)?(?:dp|gp\/product)\/[A-Z0-9]{10}/i.test(String(url ?? ''));
}

export async function findOpenAmazonProductPage(context) {
  const pages = context.pages();
  const activeAmazonProductPage = pages.find((page) => isAmazonProductPageUrl(page.url()));
  if (activeAmazonProductPage) return activeAmazonProductPage;
  return pages.find((page) => /amazon\./i.test(page.url())) ?? pages[0] ?? await context.newPage();
}

export async function detectRevsellerPanel(page, { timeoutMs = 15_000 } = {}) {
  const selector = revsellerPanelSelectors.join(', ');
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1_000);
  const locator = page.locator(selector).first();
  const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
  if (visible) return { visible: true, selector };
  const panel = await readRevsellerPanel(page);
  return { visible: Boolean(panel.panelText), selector, panelTextFound: Boolean(panel.panelText) };
}

export async function saveRevsellerPanelTextArtifact(panel, { panelTextPath = revsellerPanelTextPath } = {}) {
  await mkdir(path.dirname(panelTextPath), { recursive: true });
  await writeFile(panelTextPath, (panel?.panelTextNodes?.length ? panel.panelTextNodes.join('\n') : panel?.panelText || '').trimEnd() + '\n');
  return panelTextPath;
}

export async function saveRevsellerNotVisibleArtifacts(page, { screenshotPath = revsellerMissingScreenshotPath, htmlPath = revsellerMissingHtmlPath, panelTextPath } = {}) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(htmlPath, await page.content());
  const panel = await readRevsellerPanel(page);
  const savedPanelTextPath = await saveRevsellerPanelTextArtifact(panel, { panelTextPath: panelTextPath ?? path.join(path.dirname(htmlPath), 'revseller-panel-text.txt') });
  return { screenshotPath, htmlPath, panelTextPath: savedPanelTextPath, panelEmpty: !Boolean(panel.panelText), renderContexts: panel.renderContexts ?? [] };
}


export async function saveRevsellerPanelArtifacts(page, panel, { screenshotPath = revsellerFieldsMissingScreenshotPath, htmlPath = revsellerFieldsMissingHtmlPath } = {}) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const selector = revsellerPanelSelectors.join(', ');
  const locator = page.locator(selector).first();
  const screenshotSaved = await locator.screenshot({ path: screenshotPath }).then(() => true).catch(async () => {
    await page.screenshot({ path: screenshotPath, fullPage: false });
    return false;
  });
  await writeFile(htmlPath, panel?.panelHtml || '<!-- RevSeller panel HTML was not available. -->');
  return { screenshotPath, htmlPath, panelOnly: Boolean(panel?.panelHtml), screenshotPanelOnly: screenshotSaved };
}

export async function readRevsellerFromOpenAmazonPage(context, { reportPath = revsellerReaderReportPath } = {}) {
  const page = await findOpenAmazonProductPage(context);
  const url = page.url();
  if (!isAmazonProductPageUrl(url)) {
    const artifacts = await saveRevsellerNotVisibleArtifacts(page);
    const report = { status: 'error', error: 'No opened Amazon product page was found in the shared browser session.', pageUrl: url, artifacts, completedAt: new Date().toISOString() };
    await writeRevsellerAnalysisReport(reportPath, report);
    throw new Error(report.error);
  }

  const detection = await detectRevsellerPanel(page);
  if (!detection.visible) {
    const artifacts = await saveRevsellerNotVisibleArtifacts(page);
    const report = { status: 'error', error: 'RevSeller panel is not visible on the opened Amazon product page.', pageUrl: url, artifacts, completedAt: new Date().toISOString() };
    await writeRevsellerAnalysisReport(reportPath, report);
    throw new Error(report.error);
  }

  const panel = await readRevsellerPanel(page);
  const data = extractRevsellerFields({ ...panel, panelFound: true });
  const artifacts = revsellerFieldsFound(data) ? undefined : await saveRevsellerPanelArtifacts(page, panel);
  const report = { status: 'success', source: 'RevSeller', pageUrl: url, revsellerPanelVisible: data.revsellerPanelFound, data, ...(artifacts ? { artifacts, warning: 'RevSeller panel was visible, but expected fields were not found in the panel.' } : {}), completedAt: new Date().toISOString() };
  await writeRevsellerAnalysisReport(reportPath, report);
  return report;
}
