import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAmazonBrowserPage } from '../amazon/browser-session/index.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultProductDiscoveryPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'product-discovery.json');
export const defaultInputCandidates = [
  path.join(repositoryRoot, 'artifacts', 'main', 'final-shopping-list.json'),
  path.join(repositoryRoot, 'artifacts', 'bjs', 'logs', 'deal-products.json'),
  path.join(repositoryRoot, 'artifacts', 'costco_business_center', 'logs', 'deal-products.json'),
  path.join(repositoryRoot, 'artifacts', 'sams_club', 'logs', 'deal-products.json')
];

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalized(value) {
  return clean(value).toLowerCase();
}

function stripHtml(value) {
  return clean(String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function tokenSet(value) {
  return new Set(normalized(value).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((token) => token.length > 1));
}

function productName(product) {
  return clean(product.productName ?? product.title ?? product.name);
}

function productBrand(product) {
  return clean(product.brand);
}

export function buildAmazonSearchQuery(product) {
  return [productBrand(product), productName(product), clean(product.packageSize)].filter(Boolean).join(' ');
}

function scoreCandidate(product, candidate) {
  const sourceTokens = tokenSet(`${productBrand(product)} ${productName(product)} ${clean(product.packageSize)}`);
  const titleTokens = tokenSet(candidate.title);
  if (!sourceTokens.size || !titleTokens.size) return 0;
  let shared = 0;
  for (const token of sourceTokens) if (titleTokens.has(token)) shared += 1;
  const brandBoost = productBrand(product) && normalized(candidate.title).includes(normalized(productBrand(product))) ? 25 : 0;
  const packageBoost = clean(product.packageSize) && normalized(candidate.title).includes(normalized(product.packageSize)) ? 15 : 0;
  return Math.round((shared / sourceTokens.size) * 60 + brandBoost + packageBoost);
}

export function extractAsinFromUrl(url) {
  const match = String(url ?? '').match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})(?:[/?]|$)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function absoluteAmazonUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, 'https://www.amazon.com').toString().split('/ref=')[0];
  } catch {
    return null;
  }
}

export function parseAmazonSearchResults(html) {
  const results = [];
  const blocks = String(html ?? '').split(/data-asin="([A-Z0-9]{10})"/i);
  for (let index = 1; index < blocks.length; index += 2) {
    const asin = blocks[index].toUpperCase();
    const block = blocks[index + 1] ?? '';
    const href = block.match(/<a[^>]+href="([^"]*(?:\/dp\/|\/gp\/product\/)[^"]*)"/i)?.[1];
    const titleHtml = block.match(/<h2[\s\S]*?<\/h2>/i)?.[0] ?? block.match(/<span[^>]*class="[^"]*a-text-normal[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[0];
    const title = stripHtml(decodeHtml(titleHtml));
    if (asin && title) results.push({ asin, title, productUrl: absoluteAmazonUrl(href) ?? `https://www.amazon.com/dp/${asin}` });
  }
  return [...new Map(results.map((result) => [result.asin, result])).values()];
}

function extractMeta(html, property) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  return decodeHtml(String(html ?? '').match(pattern)?.[1] ?? '');
}

export function parseAmazonProductPage(html, url = '') {
  const page = String(html ?? '');
  const asin = extractAsinFromUrl(url) ?? page.match(/(?:data-asin|name="ASIN"|id="ASIN")=["']([A-Z0-9]{10})["']/i)?.[1]?.toUpperCase() ?? null;
  const title = stripHtml(decodeHtml(page.match(/id="productTitle"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? extractMeta(page, 'og:title')));
  const brand = stripHtml(decodeHtml(page.match(/(?:id="bylineInfo"[^>]*>|Brand:\s*<\/[^>]+>\s*<[^>]+>)([\s\S]*?)<\/[^>]+>/i)?.[1] ?? '')) || null;
  const price = stripHtml(decodeHtml(page.match(/class="[^"]*(?:a-price-whole|priceToPay|apexPriceToPay)[^"]*"[\s\S]*?<span[^>]*class="a-offscreen"[^>]*>([^<]+)<\/span>/i)?.[1] ?? page.match(/class="a-offscreen"[^>]*>(\$[0-9,.]+)/i)?.[1] ?? '')) || null;
  const packageSize = stripHtml(decodeHtml(page.match(/(?:Size|Package Quantity|Unit Count)<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? title.match(/\b\d+(?:\.\d+)?\s?(?:oz|fl oz|ounce|count|ct|pack|pk|lb|pound|g|gram|ml|l)\b/i)?.[0] ?? '')) || null;
  return { asin, title: title || null, brand, currentPrice: price, packageSize };
}

export function selectBestAmazonCandidate(product, candidates) {
  return [...candidates].map((candidate) => ({ ...candidate, matchScore: scoreCandidate(product, candidate) })).sort((a, b) => b.matchScore - a.matchScore)[0] ?? null;
}

export async function fetchAmazonPageTextWithBrowserSession(url, { page } = {}) {
  const browserPage = page ?? await getAmazonBrowserPage();
  await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return browserPage.content();
}

export async function discoverAmazonProduct(product, { fetchText, page } = {}) {
  const searchQuery = buildAmazonSearchQuery(product);
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`;
  const browserPage = page ?? (!fetchText ? await getAmazonBrowserPage() : null);
  const readPageText = fetchText ?? ((url) => fetchAmazonPageTextWithBrowserSession(url, { page: browserPage }));
  const searchHtml = await readPageText(searchUrl, { kind: 'search', product });
  const candidates = parseAmazonSearchResults(searchHtml);
  const bestCandidate = selectBestAmazonCandidate(product, candidates);
  if (!bestCandidate) return { sourceProduct: product, searchQuery, searchUrl, matched: false, amazonProduct: null, candidates: [] };
  const productHtml = await readPageText(bestCandidate.productUrl, { kind: 'product', product, candidate: bestCandidate });
  const amazonProduct = { ...bestCandidate, ...parseAmazonProductPage(productHtml, bestCandidate.productUrl) };
  return { sourceProduct: product, searchQuery, searchUrl, matched: Boolean(amazonProduct.asin), matchScore: bestCandidate.matchScore, amazonProduct };
}

export async function readInputProducts(inputPath) {
  const raw = await readFile(inputPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${inputPath} must contain an array`);
  return parsed;
}

export async function runAmazonProductDiscovery({ inputPath, products, outputPath = defaultProductDiscoveryPath, fetchText, page } = {}) {
  const resolvedInputPath = inputPath ?? defaultInputCandidates.find((candidate) => existsSync(candidate));
  if (!products && !resolvedInputPath) throw new Error('No inputPath provided and no default product artifact exists');
  const inputProducts = products ?? await readInputProducts(resolvedInputPath);
  const discoveries = [];
  const browserPage = page ?? (!fetchText ? await getAmazonBrowserPage() : null);
  for (const product of inputProducts) discoveries.push(await discoverAmazonProduct(product, { fetchText, page: browserPage }));
  const report = { engine: 'amazon-product-discovery-v1', generatedAt: new Date().toISOString(), inputPath: inputPath ? path.relative(repositoryRoot, inputPath) : null, totals: { inputProducts: inputProducts.length, matched: discoveries.filter((entry) => entry.matched).length, notMatched: discoveries.filter((entry) => !entry.matched).length }, discoveries };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repositoryRoot, 'artifacts', 'main', 'final-shopping-list.json');
  const report = await runAmazonProductDiscovery({ inputPath });
  console.log(`Amazon Product Discovery v1 complete: ${report.totals.matched}/${report.totals.inputProducts} matched.`);
  console.log(`Wrote ${path.relative(repositoryRoot, defaultProductDiscoveryPath)}`);
}
