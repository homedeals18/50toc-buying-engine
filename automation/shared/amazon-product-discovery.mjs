import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAmazonBrowserPage } from '../amazon/browser-session/index.mjs';
import { detectRevsellerPanel, extractRevsellerFields, readRevsellerPanel, revsellerFieldsFound, saveRevsellerFrameDebugArtifact, saveRevsellerNotVisibleArtifacts, saveRevsellerPanelArtifacts, saveRevsellerPanelTextArtifact, writeRevsellerAnalysisReport } from '../revseller/revseller-integration.mjs';
import { runStandardizedModule, toProjectRelativePath } from './module-interface.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultProductDiscoveryPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'product-discovery.json');
export const defaultAmazonAnalysisPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'amazon-analysis.json');
export const defaultExecutionLogPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'execution-log.json');
export const defaultExecutionReportPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'module-execution-report.json');
export const defaultRevsellerUnavailableScreenshotPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'revseller-unavailable.png');
export const defaultRevsellerUnavailableHtmlPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'revseller-unavailable.html');
export const defaultMinimumAmazonMatchScore = 60;
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

function normalizedUpc(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.replace(/^0+(?=\d{8,}$)/, '') : '';
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
  const sourceUpc = normalizedUpc(product.upc ?? product.UPC ?? product.gtin);
  const candidateUpc = normalizedUpc(candidate.upc ?? candidate.UPC ?? candidate.gtin);
  if (sourceUpc && candidateUpc) return sourceUpc === candidateUpc ? 100 : 0;

  const sourceBrand = productBrand(product);
  if (sourceBrand && !normalized(candidate.title).includes(normalized(sourceBrand))) return 0;

  const sourceTokens = tokenSet(`${sourceBrand} ${productName(product)} ${clean(product.packageSize)}`);
  const titleTokens = tokenSet(candidate.title);
  if (!sourceTokens.size || !titleTokens.size) return 0;
  let shared = 0;
  for (const token of sourceTokens) if (titleTokens.has(token)) shared += 1;
  const brandBoost = sourceBrand ? 25 : 0;
  const packageBoost = clean(product.packageSize) && normalized(candidate.title).includes(normalized(product.packageSize)) ? 15 : 0;
  return Math.min(100, Math.round((shared / sourceTokens.size) * 60 + brandBoost + packageBoost));
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
  const asin = page.match(/<(?:input|[^>]+)[^>]*(?:name|id)=["']ASIN["'][^>]*value=["']([A-Z0-9]{10})["']/i)?.[1]?.toUpperCase() ?? page.match(/data-asin=["']([A-Z0-9]{10})["']/i)?.[1]?.toUpperCase() ?? extractAsinFromUrl(url) ?? null;
  const title = stripHtml(decodeHtml(page.match(/id="productTitle"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? extractMeta(page, 'og:title')));
  const brand = stripHtml(decodeHtml(page.match(/(?:id="bylineInfo"[^>]*>|Brand:\s*<\/[^>]+>\s*<[^>]+>)([\s\S]*?)<\/[^>]+>/i)?.[1] ?? '')) || null;
  const price = stripHtml(decodeHtml(page.match(/class="[^"]*(?:a-price-whole|priceToPay|apexPriceToPay)[^"]*"[\s\S]*?<span[^>]*class="a-offscreen"[^>]*>([^<]+)<\/span>/i)?.[1] ?? page.match(/class="a-offscreen"[^>]*>(\$[0-9,.]+)/i)?.[1] ?? '')) || null;
  const packageSize = stripHtml(decodeHtml(page.match(/(?:Size|Package Quantity|Unit Count)<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\/[^>]+>/i)?.[1] ?? title.match(/\b\d+(?:\.\d+)?\s?(?:oz|fl oz|ounce|count|ct|pack|pk|lb|pound|g|gram|ml|l)\b/i)?.[0] ?? '')) || null;
  const upc = page.match(/\b(?:UPC|GTIN|EAN)\s*[:#-]?\s*([0-9-]{8,14})\b/i)?.[1]?.replace(/\D/g, '') ?? null;
  return { asin, title: title || null, brand, currentPrice: price, packageSize, upc };
}

export function selectBestAmazonCandidate(product, candidates) {
  return [...candidates].map((candidate) => ({ ...candidate, matchScore: scoreCandidate(product, candidate) })).sort((a, b) => b.matchScore - a.matchScore)[0] ?? null;
}

export async function fetchAmazonPageTextWithBrowserSession(url, { page } = {}) {
  const browserPage = page ?? await getAmazonBrowserPage();
  await browserPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return browserPage.content();
}

export async function discoverAmazonProduct(product, { fetchText, page, minimumMatchScore = defaultMinimumAmazonMatchScore } = {}) {
  const searchQuery = buildAmazonSearchQuery(product);
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`;
  const browserPage = page ?? (!fetchText ? await getAmazonBrowserPage() : null);
  const readPageText = fetchText ?? ((url) => fetchAmazonPageTextWithBrowserSession(url, { page: browserPage }));
  const searchHtml = await readPageText(searchUrl, { kind: 'search', product });
  const candidates = parseAmazonSearchResults(searchHtml);
  const bestCandidate = selectBestAmazonCandidate(product, candidates);
  if (!bestCandidate || bestCandidate.matchScore < minimumMatchScore) {
    return {
      sourceProduct: product,
      searchQuery,
      searchUrl,
      matched: false,
      matchScore: bestCandidate?.matchScore ?? null,
      amazonProduct: null,
      candidates: bestCandidate ? [bestCandidate] : [],
      rejectionReason: bestCandidate ? `Amazon match score ${bestCandidate.matchScore} is below minimum ${minimumMatchScore}` : 'No Amazon candidates found'
    };
  }
  const productHtml = await readPageText(bestCandidate.productUrl, { kind: 'product', product, candidate: bestCandidate });
  const parsedProduct = parseAmazonProductPage(productHtml, bestCandidate.productUrl);
  const productPageScore = scoreCandidate(product, parsedProduct);
  const asinMatches = Boolean(parsedProduct.asin) && parsedProduct.asin === bestCandidate.asin;
  if (!asinMatches || productPageScore < minimumMatchScore) {
    return {
      sourceProduct: product,
      searchQuery,
      searchUrl,
      matched: false,
      matchScore: productPageScore,
      amazonProduct: null,
      candidates: [bestCandidate],
      rejectionReason: !asinMatches
        ? `Opened Amazon ASIN ${parsedProduct.asin ?? 'unknown'} does not match selected ASIN ${bestCandidate.asin}`
        : `Opened Amazon product match score ${productPageScore} is below minimum ${minimumMatchScore}`
    };
  }
  const amazonProduct = { ...bestCandidate, ...parsedProduct, matchScore: productPageScore };
  return { sourceProduct: product, searchQuery, searchUrl, matched: true, matchScore: productPageScore, amazonProduct };
}

export async function readRevsellerForDiscoveredAmazonProduct(page, { screenshotPath = defaultRevsellerUnavailableScreenshotPath, htmlPath = defaultRevsellerUnavailableHtmlPath, panelTextPath, frameDebugPath } = {}) {
  const detection = await detectRevsellerPanel(page);
  if (!detection.visible) {
    const artifacts = await saveRevsellerNotVisibleArtifacts(page, { screenshotPath, htmlPath, panelTextPath });
    return {
      status: 'error',
      error: 'RevSeller panel is not visible on the opened Amazon product page.',
      pageUrl: page.url(),
      revsellerPanelVisible: false,
      artifacts
    };
  }

  const panel = await readRevsellerPanel(page);
  const debug = await saveRevsellerFrameDebugArtifact(page, panel, frameDebugPath ? { debugPath: frameDebugPath } : {});
  const savedPanelTextPath = await saveRevsellerPanelTextArtifact(panel, panelTextPath ? { panelTextPath } : {});
  if (!panel.panelText) {
    return {
      status: 'error',
      error: 'RevSeller panel text was not found in the live Amazon page.',
      pageUrl: page.url(),
      revsellerPanelVisible: detection.visible,
      artifacts: { panelTextPath: savedPanelTextPath, frameDebugPath: debug.debugPath, diagnostics: debug.diagnostics }
    };
  }
  const data = extractRevsellerFields({ ...panel, panelFound: true });
  const artifacts = revsellerFieldsFound(data) ? {} : await saveRevsellerPanelArtifacts(page, panel, { screenshotPath, htmlPath });
  return {
    status: 'success',
    source: 'RevSeller',
    pageUrl: page.url(),
    revsellerPanelVisible: data.revsellerPanelFound,
    data,
    artifacts: { ...artifacts, panelTextPath: savedPanelTextPath, frameDebugPath: debug.debugPath },
    ...(!revsellerFieldsFound(data) ? { warning: 'RevSeller panel was visible, but expected fields were not found in the panel.' } : {})
  };
}

export async function analyzeAmazonProduct(product, { fetchText, page, revsellerOptions } = {}) {
  const browserPage = page ?? (!fetchText ? await getAmazonBrowserPage() : null);
  const discovery = await discoverAmazonProduct(product, { fetchText, page: browserPage });
  const analysis = {
    storeProduct: product,
    amazonProduct: discovery.amazonProduct,
    revseller: null
  };

  if (!discovery.matched || !browserPage) {
    analysis.revseller = {
      status: 'error',
      error: discovery.matched ? 'RevSeller requires the shared browser page opened by Amazon Product Discovery.' : 'No matched Amazon product page is available for RevSeller reading.',
      pageUrl: discovery.amazonProduct?.productUrl ?? discovery.searchUrl ?? null,
      revsellerPanelVisible: false
    };
    return analysis;
  }

  analysis.revseller = await readRevsellerForDiscoveredAmazonProduct(browserPage, revsellerOptions);
  return analysis;
}

export async function runAmazonAnalysis({ product, inputPath, products, outputPath = defaultAmazonAnalysisPath, fetchText, page, revsellerOptions } = {}) {
  const resolvedInputPath = inputPath ?? defaultInputCandidates.find((candidate) => existsSync(candidate));
  const selectedProduct = product ?? products?.[0] ?? (resolvedInputPath ? (await readInputProducts(resolvedInputPath))[0] : null);
  if (!selectedProduct) throw new Error('No store product is available for Amazon analysis');
  const browserPage = page ?? (!fetchText ? await getAmazonBrowserPage() : null);
  const analysis = await analyzeAmazonProduct(selectedProduct, { fetchText, page: browserPage, revsellerOptions });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeRevsellerAnalysisReport(outputPath, analysis);
  return analysis;
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


export async function run(input = {}) {
  const outputPath = input.outputPath ?? defaultProductDiscoveryPath;
  return runStandardizedModule({
    id: 'amazon-product-discovery',
    name: 'Amazon Product Discovery',
    inputFile: input.inputPath,
    outputFile: outputPath,
    logFile: input.logFile ?? defaultExecutionLogPath,
    reportFile: input.reportFile ?? defaultExecutionReportPath
  }, async () => {
    const report = await runAmazonProductDiscovery({ ...input, outputPath });
    const inputFile = input.inputPath ?? report.inputPath;
    return {
      status: report.totals.notMatched ? 'WARNING' : 'PASS',
      inputFile,
      outputFile: outputPath,
      processedItems: report.totals.inputProducts,
      warnings: report.totals.notMatched ? [`${report.totals.notMatched} product(s) were not matched on Amazon`] : [],
      data: { totals: report.totals },
      executionReport: toProjectRelativePath(outputPath)
    };
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const runAnalysis = process.argv.includes('--analysis');
  const inputArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
  const inputPath = inputArgument ? path.resolve(inputArgument) : path.join(repositoryRoot, 'artifacts', 'main', 'final-shopping-list.json');
  if (runAnalysis) {
    const analysis = await runAmazonAnalysis({ inputPath: inputArgument ? inputPath : undefined });
    console.log(`Amazon Analysis complete: ${analysis.amazonProduct?.asin ?? 'no Amazon match'}.`);
    console.log(`Wrote ${path.relative(repositoryRoot, defaultAmazonAnalysisPath)}`);
  } else {
    const report = await runAmazonProductDiscovery({ inputPath });
    console.log(`Amazon Product Discovery v1 complete: ${report.totals.matched}/${report.totals.inputProducts} matched.`);
    console.log(`Wrote ${path.relative(repositoryRoot, defaultProductDiscoveryPath)}`);
  }
}
