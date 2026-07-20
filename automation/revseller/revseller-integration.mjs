import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitiveText } from './connector-config.mjs';
import { confidenceRules, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const amazonArtifactRoot = path.join(repositoryRoot, 'artifacts', 'amazon');
export const amazonAnalysisReportPath = path.join(amazonArtifactRoot, 'revseller-analysis-report.json');
export const revsellerArtifactRoot = path.join(repositoryRoot, 'artifacts', 'revseller');
export const revsellerReaderReportPath = path.join(revsellerArtifactRoot, 'revseller-analysis-report.json');
export const revsellerMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.png');
export const revsellerMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.html');
export const revsellerFieldsMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.png');
export const revsellerFieldsMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.html');
export const amazonRevsellerFrameDebugPath = path.join(amazonArtifactRoot, 'revseller-frame-debug.json');
export const amazonRevsellerPanelTextPath = path.join(amazonArtifactRoot, 'revseller-panel-text.txt');
export const revsellerPanelTextPath = amazonRevsellerPanelTextPath;
export const revsellerRootHtmlPath = path.join(revsellerArtifactRoot, 'revseller-root.html');
export const revsellerRootTextPath = path.join(revsellerArtifactRoot, 'revseller-root-text.txt');
export const revsellerRootCandidatesPath = path.join(revsellerArtifactRoot, 'revseller-root-candidates.json');

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

function firstValid(predicate, ...values) {
  return values.find((value) => String(value ?? '').trim() && predicate(String(value).trim())) ?? null;
}

function isMoneyValue(value) {
  return /-?\$\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?/.test(String(value ?? ''));
}

function isPercentValue(value) {
  return /-?\s*[0-9]+(?:\.[0-9]+)?\s*%/.test(String(value ?? ''));
}

function meaningfulWarning(value, label) {
  const cleaned = String(value ?? '').trim();
  if (!cleaned || new RegExp(`^(?:${label}|position)import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSensitiveText } from './connector-config.mjs';
import { confidenceRules, matchProductToAmazon } from '../shared/amazon-matching-engine.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const amazonArtifactRoot = path.join(repositoryRoot, 'artifacts', 'amazon');
export const amazonAnalysisReportPath = path.join(amazonArtifactRoot, 'revseller-analysis-report.json');
export const revsellerArtifactRoot = path.join(repositoryRoot, 'artifacts', 'revseller');
export const revsellerReaderReportPath = path.join(revsellerArtifactRoot, 'revseller-analysis-report.json');
export const revsellerMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.png');
export const revsellerMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-not-visible.html');
export const revsellerFieldsMissingScreenshotPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.png');
export const revsellerFieldsMissingHtmlPath = path.join(revsellerArtifactRoot, 'revseller-panel-fields-missing.html');
export const amazonRevsellerFrameDebugPath = path.join(amazonArtifactRoot, 'revseller-frame-debug.json');
export const amazonRevsellerPanelTextPath = path.join(amazonArtifactRoot, 'revseller-panel-text.txt');
export const revsellerPanelTextPath = amazonRevsellerPanelTextPath;
export const revsellerRootHtmlPath = path.join(revsellerArtifactRoot, 'revseller-root.html');
export const revsellerRootTextPath = path.join(revsellerArtifactRoot, 'revseller-root-text.txt');
export const revsellerRootCandidatesPath = path.join(revsellerArtifactRoot, 'revseller-root-candidates.json');

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

function firstValid(predicate, ...values) {
  return values.find((value) => String(value ?? '').trim() && predicate(String(value).trim())) ?? null;
}

function isMoneyValue(value) {
  return /-?\$\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?/.test(String(value ?? ''));
}

function isPercentValue(value) {
  return /-?\s*[0-9]+(?:\.[0-9]+)?\s*%/.test(String(value ?? ''));
}

function meaningfulWarning(value, labels) {
  const cleaned = String(value ?? '').trim();
  const ignored = ['position', ...(Array.isArray(labels) ? labels : [labels])]
    .map((label) => String(label ?? '').trim().toLowerCase())
    .filter(Boolean);
  if (!cleaned || ignored.includes(cleaned.toLowerCase())) return null;
  return cleaned;
}

function textFromVisibleTextCandidates(visibleTextCandidates = []) {
  return [...new Set(visibleTextCandidates.flatMap((candidate) => [
    candidate?.text,
    ...(Array.isArray(candidate?.textNodes) ? candidate.textNodes : [])
  ]).map((value) => String(value ?? '').trim()).filter(Boolean))].join(' ');
}

function rawPanelTextFromPanel(panel = {}) {
  const candidates = [
    panel.panelText,
    textFromVisibleTextCandidates(panel.diagnostics?.visibleTextCandidates),
    ...((panel.frameDebug ?? []).map((entry) => textFromVisibleTextCandidates(entry?.diagnostics?.visibleTextCandidates))),
    textFromVisibleTextCandidates(panel.visibleTextCandidates)
  ].map((value) => String(value ?? '').trim()).filter(Boolean);

  const signalPattern = /\b(?:Sell Price|Buy Box|Low FBA|FBA Fees?|ROI|Rstr|BSR|30d Sales|90d Rank|Max Cost)\b/gi;
  const score = (value) => (value.match(signalPattern)?.length ?? 0) * 10_000 + value.length;
  return candidates.sort((left, right) => score(right) - score(left))[0] ?? '';
}

function hasExtractedRevsellerValues(data) {
  return Boolean(data.sellingPrice || data.fbaFees || data.estimatedProfit || data.roi || data.bsr || data.category || data.hazmatWarning || data.meltableWarning || data.ipRestrictionWarnings);
}

export function extractRevsellerFields({ panelText, asin, productTitle, productUrl, fields = {}, panelFound, diagnostics, frameDebug, visibleTextCandidates } = {}) {
  const text = rawPanelTextFromPanel({ panelText, diagnostics, frameDebug, visibleTextCandidates });
  const found = panelFound ?? Boolean(text.trim() || Object.values(fields).some((value) => String(value ?? '').trim()));
  const extractedAsin = firstNonEmpty(fields.asin, valueAfterLabel(text, 'ASIN'), text.match(/\b[A-Z0-9]{10}\b/)?.[0], asin);
  const priceText = firstValid(
    isMoneyValue,
    text.match(/\bBuy Box\s+(\$[0-9,.]+)/i)?.[1],
    text.match(/\bLow FBA\s+(\$[0-9,.]+)/i)?.[1],
    valueAfterLabel(text, '(?:Selling Price|Sell Price|Current Amazon Price|Amazon Price|Price)'),
    fields.sellingPrice,
    fields.currentAmazonPrice
  );
  const feeText = firstValid(isMoneyValue, valueAfterLabel(text, '(?:FBA Fees?|Fees?)'), fields.fbaFees);
  const profitText = firstValid(isMoneyValue, valueAfterLabel(text, '(?:Estimated Profit|Est\\.? Profit|Net Profit|Profit)'), fields.estimatedProfit);
  const roiText = firstValid(isPercentValue, valueAfterLabel(text, 'ROI'), fields.roi);
  const hazmatText = meaningfulWarning(firstNonEmpty(valueAfterLabel(text, 'Hazmat'), fields.hazmatWarning), 'hazmat');
  const meltableText = meaningfulWarning(firstNonEmpty(valueAfterLabel(text, 'Meltable'), fields.meltableWarning), 'meltable');
  const ipText = meaningfulWarning(firstNonEmpty(valueAfterLabel(text, '(?:IP / Restriction warnings?|IP Alert|IP Warning|Restriction warnings?|Restrictions?)'), fields.ipRestrictionWarnings), ['ip', 'ip alert', 'ip warning', 'restriction', 'restrictions']);
  return {
    asin: extractedAsin,
    productTitle: firstNonEmpty(fields.productTitle, valueAfterLabel(text, '(?:Product Title|Title)'), productTitle),
    productUrl: productUrl || null,
    sellingPrice: priceText || null,
    currentAmazonPrice: parseMoney(priceText),
    fbaFees: feeText || null,
    estimatedProfit: profitText || null,
    roi: roiText || null,
    bsr: firstNonEmpty(text.match(/\bRstr\s+([0-9,]+)/i)?.[1], valueAfterLabel(text, '(?:BSR|Best Sellers Rank|Sales Rank|Rank)'), fields.bsr),
    category: firstNonEmpty(text.match(/\bRstr\s+[0-9,]+\s+in\s+(.+?)\s+[0-9]+(?:\.[0-9]+)?%\s+30d Sales/i)?.[1], valueAfterLabel(text, 'Category'), fields.category),
    hazmatWarning: hazmatText || null,
    meltableWarning: meltableText || null,
    ipRestrictionWarnings: ipText || null,
    hazmat: hazmatText || null,
    meltable: meltableText || null,
    ipAlert: ipText || null,
    variation: meaningfulWarning(firstNonEmpty(valueAfterLabel(text, 'Variation'), fields.variation), 'variation'),
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
  const extensionSpecificSelectors = [
    '[id*="revseller" i]',
    '[class*="revseller" i]',
    '[data-testid*="revseller" i]',
    '[data-test*="revseller" i]',
    '[data-extension*="revseller" i]',
    '[data-extension-id*="revseller" i]',
    '[data-chrome-extension*="revseller" i]',
    '[aria-label*="revseller" i]',
    'iframe[src*="revseller" i]',
    'iframe[src^="chrome-extension://"]',
    '[id^="rs-"]',
    '[class^="rs-"]',
    '[class*=" rs-"]',
    '[data-rs]',
    '[data-rs-root]',
    '[data-revseller]'
  ];
  const selector = extensionSpecificSelectors.join(', ');
  const visibleTextNodes = (root) => {
    const nodes = [];
    const isVisibleElement = (element) => {
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0 || element.tagName === 'IFRAME' || element === document.body || element === document.documentElement;
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
  const cssPath = (node) => {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const segments = [];
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let segment = current.tagName.toLowerCase();
      if (current.id) segment += `#${CSS.escape(current.id)}`;
      const classNames = String(current.className || '').split(/\s+/).filter(Boolean).slice(0, 3);
      if (!current.id && classNames.length) segment += classNames.map((name) => `.${CSS.escape(name)}`).join('');
      const parent = current.parentElement;
      if (parent && !current.id) {
        const sameTagSiblings = [...parent.children].filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) segment += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
      segments.unshift(segment);
      if (current.id) break;
      current = parent;
    }
    return segments.join(' > ');
  };
  const matchedSelectors = (node) => extensionSpecificSelectors.filter((candidateSelector) => {
    try { return node.matches(candidateSelector); } catch { return false; }
  });
  const asin = location.href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1] || document.querySelector('[name="ASIN"]')?.value || null;
  const productTitle = clean(document.querySelector('#productTitle')?.textContent || document.title);
  const shadowHosts = [...document.querySelectorAll('*')].filter((node) => node.shadowRoot);
  const iframes = [...document.querySelectorAll('iframe')].map((iframe) => ({
    src: iframe.src || iframe.getAttribute('src') || null,
    id: iframe.id || null,
    name: iframe.name || iframe.getAttribute('name') || null,
    title: iframe.title || iframe.getAttribute('title') || null,
    visible: (() => {
      const style = getComputedStyle(iframe);
      const rect = iframe.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && (rect.width > 0 || rect.height > 0);
    })()
  }));
  const candidates = [...document.querySelectorAll(selector)];
  for (const host of shadowHosts) candidates.push(...host.shadowRoot.querySelectorAll(selector));
  const isExtensionRenderContext = /^chrome-extension:\/\//i.test(location.href) || /revseller/i.test(location.href);
  if (isExtensionRenderContext && document.body) candidates.push(document.body);
  const unique = [...new Set(candidates)].filter((node) => node?.isConnected);
  const scored = unique.map((node, index) => {
    const textNodes = visibleTextNodes(node);
    const text = clean(textNodes.join(' ') || node.innerText || node.textContent || node.getAttribute('src')) || '';
    const selectorHits = matchedSelectors(node);
    const source = `${node.id || ''} ${String(node.className || '')} ${node.getAttribute?.('src') || ''} ${location.href}`;
    const score = selectorHits.length * 20 + (/revseller/i.test(source) ? 50 : 0) + (/^chrome-extension:\/\//i.test(node.getAttribute?.('src') || location.href) ? 25 : 0) - Math.min(text.length / 1000, 10);
    return { node, text, textNodes, score, index, selectorHits, domPath: cssPath(node), hasShadowRoot: Boolean(node.shadowRoot), isIframe: node.tagName === 'IFRAME' };
  }).sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.index - b.index);
  const panel = scored[0] || null;
  const panelNode = panel?.node || null;
  const panelText = panel?.text || '';
  const panelTextNodes = panel?.textNodes || [];
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
  const rootCandidates = scored.slice(0, 50).map(({ text, textNodes, score, hasShadowRoot, isIframe, node, domPath, selectorHits }) => ({
    score, isIframe, hasShadowRoot, domPath, matchedSelectors: selectorHits, tagName: node.tagName, id: node.id || null, className: String(node.className || '') || null,
    html: node.outerHTML || null,
    text: text.slice(0, 5000),
    textNodes: textNodes.slice(0, 200)
  }));
  return {
    asin, productTitle, productUrl: location.href, panelText, panelTextNodes, panelHtml, fields,
    rootDomPath: panel?.domPath || null,
    rootScore: panel?.score ?? 0,
    rootMatchedSelectors: panel?.selectorHits || [],
    rootCandidates,
    panelFound: Boolean(panelNode),
    diagnostics: {
      frameUrl: location.href,
      frameTitle: document.title || null,
      isTopFrame: window.top === window,
      revsellerPanelPresent: Boolean(panelNode),
      iframeCount: iframes.length,
      iframes,
      shadowRootCount: shadowHosts.length,
      shadowHosts: shadowHosts.slice(0, 100).map((node) => ({ tagName: node.tagName, id: node.id || null, className: String(node.className || '') || null })),
      visibleTextCandidates: rootCandidates.map(({ html, ...candidate }) => candidate)
    },
    renderContexts: scored.map(({ isIframe, hasShadowRoot, score }) => ({ isIframe, hasShadowRoot, score }))
  };
}

export async function readRevsellerPanel(page) {
  await page.waitForTimeout(5_000);
  const frames = typeof page.frames === 'function' ? page.frames() : [page];
  const framePanels = await Promise.all(frames.map(async (frame, index) => {
    const metadata = {
      index,
      url: typeof frame.url === 'function' ? frame.url() : null,
      name: typeof frame.name === 'function' ? frame.name() : null
    };
    const panel = await frame.evaluate(revsellerPanelBrowserReader).catch((error) => ({
      panelText: '',
      panelTextNodes: [],
      fields: {},
      panelFound: false,
      diagnostics: { frameUrl: metadata.url, evaluateError: error.message }
    }));
    return { ...panel, frame: metadata, diagnostics: { ...panel.diagnostics, ...metadata } };
  }));
  const best = framePanels.filter(Boolean).sort((a, b) => Number(Boolean(b.panelFound)) - Number(Boolean(a.panelFound)) || (b.rootScore ?? 0) - (a.rootScore ?? 0) || Number(Boolean(b.panelText)) - Number(Boolean(a.panelText)) || (a.panelText?.length || 0) - (b.panelText?.length || 0))[0] ?? { panelText: '', panelTextNodes: [], fields: {}, panelFound: false };
  return { ...best, frameDebug: framePanels };
}


export const revsellerPanelSelectors = [
  '[id*="revseller" i]',
  '[class*="revseller" i]',
  '[data-testid*="revseller" i]',
  '[data-test*="revseller" i]',
  '[data-extension*="revseller" i]',
  '[data-extension-id*="revseller" i]',
  '[data-chrome-extension*="revseller" i]',
  '[aria-label*="revseller" i]',
  'iframe[src*="revseller" i]',
  'iframe[src^="chrome-extension://"]',
  '[id^="rs-"]',
  '[class^="rs-"]',
  '[class*=" rs-"]',
  '[data-rs]',
  '[data-rs-root]',
  '[data-revseller]'
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
  return { visible: Boolean(panel.panelFound), selector, panelTextFound: Boolean(panel.panelText), rootDomPath: panel.rootDomPath ?? null };
}

export async function saveRevsellerPanelTextArtifact(panel, { panelTextPath = revsellerPanelTextPath } = {}) {
  await mkdir(path.dirname(panelTextPath), { recursive: true });
  await writeFile(panelTextPath, rawPanelTextFromPanel(panel));
  return panelTextPath;
}

export async function collectRevsellerLiveDiagnostics(page, panel = {}) {
  const frameDebug = panel.frameDebug ?? [];
  const context = typeof page.context === 'function' ? page.context() : null;
  const serviceWorkerUrls = context?.serviceWorkers?.().map((worker) => worker.url()) ?? [];
  const detectedExtensionUrls = serviceWorkerUrls.filter((url) => url.startsWith('chrome-extension://'));
  const visibleTextCandidates = frameDebug.flatMap((entry) => entry.diagnostics?.visibleTextCandidates ?? []);
  const revsellerPanelPresent = frameDebug.some((entry) => entry.diagnostics?.revsellerPanelPresent || entry.panelFound);
  return {
    generatedAt: new Date().toISOString(),
    pageUrl: page.url(),
    isUserLoggedIntoRevseller: panel.panelText ? true : revsellerPanelPresent ? null : false,
    isChromeExtensionLoaded: detectedExtensionUrls.length > 0 || revsellerPanelPresent,
    detectedExtensionUrls,
    isRevsellerPanelPresentInLivePage: revsellerPanelPresent,
    hasIframes: frameDebug.some((entry) => (entry.diagnostics?.iframeCount ?? 0) > 0) || frameDebug.length > 1,
    hasShadowRoots: frameDebug.some((entry) => (entry.diagnostics?.shadowRootCount ?? 0) > 0),
    frames: frameDebug.map((entry) => ({
      index: entry.frame?.index ?? entry.diagnostics?.index,
      url: entry.frame?.url ?? entry.diagnostics?.frameUrl,
      name: entry.frame?.name ?? null,
      panelFound: Boolean(entry.panelFound),
      panelTextLength: entry.panelText?.length ?? 0,
      iframeCount: entry.diagnostics?.iframeCount ?? 0,
      shadowRootCount: entry.diagnostics?.shadowRootCount ?? 0,
      iframes: entry.diagnostics?.iframes ?? [],
      visibleTextCandidates: entry.diagnostics?.visibleTextCandidates ?? [],
      evaluateError: entry.diagnostics?.evaluateError
    })),
    visibleTextCandidates
  };
}

export async function saveRevsellerFrameDebugArtifact(page, panel, { debugPath = amazonRevsellerFrameDebugPath } = {}) {
  await mkdir(path.dirname(debugPath), { recursive: true });
  const diagnostics = await collectRevsellerLiveDiagnostics(page, panel);
  await writeFile(debugPath, JSON.stringify(diagnostics, null, 2));
  return { debugPath, diagnostics };
}

export async function saveRevsellerRootArtifacts(panel, { htmlPath = revsellerRootHtmlPath, textPath = revsellerRootTextPath, candidatesPath = revsellerRootCandidatesPath } = {}) {
  await mkdir(path.dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, panel?.panelHtml || '<!-- RevSeller root HTML was not available because no extension-specific root was found. -->');
  await writeFile(textPath, rawPanelTextFromPanel(panel));
  await writeFile(candidatesPath, JSON.stringify({
    selectedDomPath: panel?.rootDomPath ?? null,
    selectedMatchedSelectors: panel?.rootMatchedSelectors ?? [],
    candidates: panel?.rootCandidates ?? []
  }, null, 2));
  return { rootHtmlPath: htmlPath, rootTextPath: textPath, rootCandidatesPath: candidatesPath };
}

export async function saveRevsellerNotVisibleArtifacts(page, { screenshotPath = revsellerMissingScreenshotPath, htmlPath = revsellerMissingHtmlPath, panelTextPath } = {}) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await writeFile(htmlPath, await page.content());
  const panel = await readRevsellerPanel(page);
  const debug = await saveRevsellerFrameDebugArtifact(page, panel);
  const savedPanelTextPath = await saveRevsellerPanelTextArtifact(panel, { panelTextPath: panelTextPath ?? path.join(path.dirname(htmlPath), 'revseller-panel-text.txt') });
  const rootArtifacts = await saveRevsellerRootArtifacts(panel);
  return { screenshotPath, htmlPath, panelTextPath: savedPanelTextPath, ...rootArtifacts, frameDebugPath: debug.debugPath, diagnostics: debug.diagnostics, panelEmpty: !Boolean(panel.panelText), renderContexts: panel.renderContexts ?? [] };
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
  const rootArtifacts = await saveRevsellerRootArtifacts(panel, { htmlPath, textPath: path.join(path.dirname(htmlPath), 'revseller-root-text.txt'), candidatesPath: path.join(path.dirname(htmlPath), 'revseller-root-candidates.json') });
  return { screenshotPath, htmlPath, ...rootArtifacts, panelOnly: Boolean(panel?.panelHtml), screenshotPanelOnly: screenshotSaved };
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
  const debug = await saveRevsellerFrameDebugArtifact(page, panel);
  const panelTextPath = await saveRevsellerPanelTextArtifact(panel);
  const rootArtifacts = await saveRevsellerRootArtifacts(panel);
  if (!panel.panelText) {
    const report = {
      status: 'error',
      error: 'RevSeller panel text was not found in the live Amazon page.',
      pageUrl: url,
      revsellerPanelVisible: detection.visible,
      artifacts: { panelTextPath, ...rootArtifacts, frameDebugPath: debug.debugPath, diagnostics: debug.diagnostics },
      completedAt: new Date().toISOString()
    };
    await writeRevsellerAnalysisReport(reportPath, report);
    throw new Error(report.error);
  }
  const data = extractRevsellerFields({ ...panel, panelFound: true });
  const artifacts = revsellerFieldsFound(data) ? undefined : await saveRevsellerPanelArtifacts(page, panel);
  const report = { status: 'success', source: 'RevSeller', pageUrl: url, revsellerPanelVisible: data.revsellerPanelFound, data, artifacts: { ...(artifacts ?? {}), panelTextPath, ...rootArtifacts, frameDebugPath: debug.debugPath }, ...(artifacts ? { warning: 'RevSeller panel was visible, but expected fields were not found in the panel.' } : {}), completedAt: new Date().toISOString() };
  await writeRevsellerAnalysisReport(reportPath, report);
  return report;
}
