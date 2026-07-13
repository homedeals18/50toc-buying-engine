import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStandardizedModule } from '../shared/module-interface.mjs';

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const defaultInputPath = path.join(repositoryRoot, 'artifacts', 'amazon', 'product-discovery.json');
export const defaultOutputPath = path.join(repositoryRoot, 'artifacts', 'profit-analyzer', 'profit-analysis.json');
export const defaultExecutionReportPath = path.join(repositoryRoot, 'artifacts', 'profit-analyzer', 'execution-report.json');
export const defaultExecutionLogPath = path.join(repositoryRoot, 'artifacts', 'profit-analyzer', 'execution-log.json');

export const MARKETPLACES = Object.freeze({
  ATVPDKIKX0DER: { id: 'ATVPDKIKX0DER', countryCode: 'US', endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', currency: 'USD' },
  US: { id: 'ATVPDKIKX0DER', countryCode: 'US', endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', currency: 'USD' },
  A2EUQ1WTGCTBG2: { id: 'A2EUQ1WTGCTBG2', countryCode: 'CA', endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', currency: 'CAD' },
  CA: { id: 'A2EUQ1WTGCTBG2', countryCode: 'CA', endpoint: 'https://sellingpartnerapi-na.amazon.com', region: 'us-east-1', currency: 'CAD' }
});

const DECISIONS = Object.freeze({ BUY: 'BUY', DONT_BUY: "DON'T_BUY", NEEDS_REVIEW: 'NEEDS_REVIEW' });

function isProvidedNumber(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }
function roundMoney(value) { return isProvidedNumber(value) ? Math.round(Number(value) * 100) / 100 : null; }
function roundPercent(value) { return isProvidedNumber(value) ? Math.round(Number(value) * 100) / 100 : null; }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function compactObject(value) { return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)); }
function env(name) { return process.env[name]?.trim() || null; }

export function normalizeMarketplace(marketplace = 'US') {
  const found = MARKETPLACES[String(marketplace).toUpperCase()] ?? MARKETPLACES[String(marketplace)];
  if (!found) throw new Error(`Unsupported Amazon marketplace: ${marketplace}`);
  return found;
}

export function validateProfitInput(input = {}) {
  const asin = String(input.asin ?? input.amazonAsin ?? '').trim().toUpperCase();
  const purchaseCost = numberOrNull(input.purchaseCost ?? input.purchasePrice ?? input.lowestPurchasePrice ?? input.currentPrice ?? input.price);
  const fulfillmentMethod = String(input.fulfillmentMethod ?? 'FBA').trim().toUpperCase();
  const inboundShipping = numberOrNull(input.inboundShipping ?? input.inboundShippingCost ?? input.inboundShippingCostPerUnit ?? 0);
  const minimumTargetRoi = numberOrNull(input.minimumTargetRoi ?? input.minimumTargetRoiPercent ?? 30);
  const prepCost = numberOrNull(input.prepCost ?? input.prepAndLabelingCost ?? input.prepAndLabelCost ?? 0);
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error('Profit Analyzer requires a valid 10-character ASIN.');
  if (purchaseCost === null || purchaseCost < 0) throw new Error('Profit Analyzer requires a non-negative purchase cost.');
  if (!['FBA', 'FBM'].includes(fulfillmentMethod)) throw new Error('fulfillmentMethod must be FBA or FBM.');
  return { asin, marketplace: normalizeMarketplace(input.marketplace ?? input.amazonMarketplace ?? 'US'), purchaseCost, fulfillmentMethod, inboundShipping: inboundShipping ?? 0, minimumTargetRoi: minimumTargetRoi ?? 30, prepCost: prepCost ?? 0, sourceProduct: input.sourceProduct ?? input };
}

export function calculateProfitability({ sellingPrice, estimatedAmazonFees, purchaseCost, inboundShipping = 0, prepCost = 0, minimumTargetRoi = 30 }) {
  const missingData = [];
  for (const [key, value] of Object.entries({ sellingPrice, estimatedAmazonFees, purchaseCost })) if (!isProvidedNumber(value)) missingData.push(key);
  const totalLandedCost = roundMoney(Number(purchaseCost) + Number(inboundShipping ?? 0) + Number(prepCost ?? 0));
  const netProceeds = isProvidedNumber(sellingPrice) && isProvidedNumber(estimatedAmazonFees) ? roundMoney(Number(sellingPrice) - Number(estimatedAmazonFees)) : null;
  const estimatedProfit = netProceeds !== null && Number.isFinite(totalLandedCost) ? roundMoney(netProceeds - totalLandedCost) : null;
  const roi = estimatedProfit !== null && totalLandedCost > 0 ? roundPercent((estimatedProfit / totalLandedCost) * 100) : null;
  const maxLandedCost = netProceeds !== null ? roundMoney(netProceeds / (1 + Number(minimumTargetRoi) / 100)) : null;
  const maxPurchaseCost = maxLandedCost !== null ? roundMoney(maxLandedCost - Number(inboundShipping ?? 0) - Number(prepCost ?? 0)) : null;
  return { sellingPrice: roundMoney(sellingPrice), estimatedAmazonFees: roundMoney(estimatedAmazonFees), purchaseCost: roundMoney(purchaseCost), inboundShipping: roundMoney(inboundShipping), prepCost: roundMoney(prepCost), totalLandedCost, netProceeds, estimatedProfit, roi, minimumTargetRoi: roundPercent(minimumTargetRoi), maxLandedCost, maxPurchaseCost, missingData };
}

export function decideProfitAnalysis({ profitability, restrictions, pricing, fees }) {
  const missingData = [...new Set([...(profitability?.missingData ?? []), ...(pricing?.missingData ?? []), ...(fees?.missingData ?? [])])];
  const reasons = [];
  let decision = DECISIONS.BUY;
  let confidence = 90;
  if (missingData.length) { decision = DECISIONS.NEEDS_REVIEW; confidence = 45; reasons.push(`Missing required data: ${missingData.join(', ')}`); }
  if (restrictions?.canSell === false) { decision = DECISIONS.DONT_BUY; confidence = 95; reasons.push('Authenticated seller is restricted from selling this ASIN.'); }
  else if (restrictions?.approvalRequired) { decision = DECISIONS.NEEDS_REVIEW; confidence = Math.min(confidence, 55); reasons.push('Selling approval is required for this ASIN.'); }
  if (profitability?.roi !== null && profitability.roi < profitability.minimumTargetRoi) { decision = DECISIONS.DONT_BUY; confidence = Math.max(confidence, 85); reasons.push(`Estimated ROI ${profitability.roi}% is below target ${profitability.minimumTargetRoi}%.`); }
  if (decision === DECISIONS.BUY) reasons.push('Estimated ROI meets target and no listing restriction was returned.');
  return { decision, reasons, missingData, confidence };
}

export function getSpApiConfig({ marketplace = 'US' } = {}) {
  const market = normalizeMarketplace(marketplace);
  const config = { marketplace: market, clientId: env('SP_API_CLIENT_ID'), clientSecret: env('SP_API_CLIENT_SECRET'), refreshToken: env('SP_API_REFRESH_TOKEN'), awsAccessKeyId: env('SP_API_AWS_ACCESS_KEY_ID'), awsSecretAccessKey: env('SP_API_AWS_SECRET_ACCESS_KEY'), awsSessionToken: env('SP_API_AWS_SESSION_TOKEN'), roleArn: env('SP_API_ROLE_ARN'), sellerId: env('SP_API_SELLER_ID') };
  const missing = Object.entries(config).filter(([key, value]) => ['clientId','clientSecret','refreshToken','awsAccessKeyId','awsSecretAccessKey'].includes(key) && !value).map(([key]) => key);
  return { ...config, missing };
}

async function requestAccessToken(config) {
  const response = await fetch('https://api.amazon.com/auth/o2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: config.refreshToken, client_id: config.clientId, client_secret: config.clientSecret }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`SP-API LWA token request failed (${response.status}): ${JSON.stringify(data)}`);
  return data.access_token;
}
function hmac(key, data, encoding) { return crypto.createHmac('sha256', key).update(data).digest(encoding); }
function hash(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function signingKey(secret, date, region) { return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 'execute-api'), 'aws4_request'); }
function encodeRfc3986(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }

export class SpApiClient {
  constructor(config) { this.config = config; this.accessToken = null; }
  async ensureToken() { this.accessToken ??= await requestAccessToken(this.config); return this.accessToken; }
  async request(method, pathname, { query = {}, body = null } = {}) {
    const accessToken = await this.ensureToken();
    const market = this.config.marketplace;
    const url = new URL(pathname, market.endpoint);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    const payload = body ? JSON.stringify(body) : '';
    const now = new Date(); const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); const dateStamp = amzDate.slice(0, 8);
    const canonicalQuery = [...url.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
    const headers = { host: url.host, 'x-amz-access-token': accessToken, 'x-amz-date': amzDate, ...(this.config.awsSessionToken ? { 'x-amz-security-token': this.config.awsSessionToken } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join('');
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, hash(payload)].join('\n');
    const credentialScope = `${dateStamp}/${market.region}/execute-api/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
    const signature = hmac(signingKey(this.config.awsSecretAccessKey, dateStamp, market.region), stringToSign, 'hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(url, { method, headers: { ...headers, authorization }, body: body ? payload : undefined });
    const data = await response.json().catch(async () => ({ raw: await response.text().catch(() => '') }));
    if (!response.ok) throw new Error(`SP-API ${method} ${pathname} failed (${response.status}): ${JSON.stringify(data)}`);
    return data;
  }
}

export function parseCatalog(catalog = {}, asin) {
  const item = catalog.items?.[0] ?? catalog;
  const summary = item.summaries?.[0] ?? {};
  const dims = item.dimensions?.[0] ?? {};
  const salesRank = item.salesRanks?.[0]?.ranks?.[0] ?? item.salesRanks?.[0] ?? null;
  return { asin: item.asin ?? asin, title: summary.itemName ?? null, brand: summary.brand ?? null, identifiers: item.identifiers ?? [], packageDimensions: dims.package ?? dims.item ?? null, category: summary.productType ?? item.productTypes?.[0]?.productType ?? null, salesRank: salesRank ? { rank: salesRank.rank ?? null, title: salesRank.title ?? salesRank.displayGroup ?? null } : null };
}
export function parsePricing(pricing = {}) {
  const payload = pricing.payload?.[0] ?? pricing.payload ?? pricing;
  const summary = payload.Summary ?? payload.summary ?? {};
  const buyBox = summary.BuyBoxPrices?.[0]?.LandedPrice ?? summary.FeaturedOffer?.LandedPrice ?? null;
  const competitive = payload.CompetitivePricing?.CompetitivePrices?.[0]?.Price?.LandedPrice ?? buyBox;
  const price = competitive?.Amount ?? buyBox?.Amount ?? null;
  return { currentCompetitiveSellingPrice: roundMoney(price), featuredOfferPrice: roundMoney(buyBox?.Amount), offerCount: summary.TotalOfferCount ?? null, amazonOfferPresent: Boolean(summary.NumberOfOffers?.some?.((o) => String(o.condition).toLowerCase() === 'new' && o.fulfillmentChannel === 'Amazon') ?? false), missingData: price === null ? ['sellingPrice'] : [] };
}
export function parseFees(fees = {}) {
  const estimate = fees.payload?.FeesEstimateResult?.FeesEstimate ?? fees.FeesEstimateResult?.FeesEstimate ?? fees;
  const details = estimate.FeeDetailList ?? [];
  const amountFor = (name) => details.find((d) => d.FeeType === name)?.FeeAmount?.Amount ?? null;
  const total = estimate.TotalFeesEstimate?.Amount ?? null;
  return { referralFee: roundMoney(amountFor('ReferralFee')), fbaFulfillmentFee: roundMoney(amountFor('FBAFees') ?? amountFor('FBAPerUnitFulfillmentFee')), variableClosingFee: roundMoney(amountFor('VariableClosingFee')), totalEstimatedAmazonFees: roundMoney(total), errors: fees.payload?.FeesEstimateResult?.Error ? [fees.payload.FeesEstimateResult.Error] : [], missingData: total === null ? ['estimatedAmazonFees'] : [] };
}
export function parseRestrictions(restrictions = {}) {
  const entries = restrictions.restrictions ?? [];
  const approvalRequired = entries.some((r) => r.reasons?.some?.((reason) => /approval/i.test(reason.reasonCode ?? reason.message ?? '')));
  return { canSell: entries.length === 0, approvalRequired, reasons: entries.flatMap((r) => r.reasons ?? []).map((r) => compactObject({ code: r.reasonCode, message: r.message })) };
}

export async function fetchSpApiAnalysis(input, { client } = {}) {
  const normalized = validateProfitInput(input);
  const sp = client ?? new SpApiClient(getSpApiConfig({ marketplace: normalized.marketplace.id }));
  const asin = normalized.asin; const marketplaceIds = normalized.marketplace.id;
  const [catalogRaw, pricingRaw, restrictionsRaw] = await Promise.all([
    sp.request('GET', `/catalog/2022-04-01/items/${asin}`, { query: { marketplaceIds, includedData: 'summaries,identifiers,dimensions,salesRanks,productTypes' } }),
    sp.request('GET', '/products/pricing/v0/competitivePrice', { query: { MarketplaceId: marketplaceIds, Asins: asin, ItemType: 'Asin' } }),
    sp.request('GET', `/listings/2021-08-01/restrictions`, { query: { asin, sellerId: sp.config.sellerId, marketplaceIds, conditionType: 'new_new' } })
  ]);
  const catalog = parseCatalog(catalogRaw, asin); const pricing = parsePricing(pricingRaw);
  const feesRaw = await sp.request('POST', `/products/fees/v0/items/${asin}/feesEstimate`, { body: { FeesEstimateRequest: { MarketplaceId: marketplaceIds, IsAmazonFulfilled: normalized.fulfillmentMethod === 'FBA', PriceToEstimateFees: { ListingPrice: { CurrencyCode: normalized.marketplace.currency, Amount: pricing.currentCompetitiveSellingPrice ?? 0 } }, Identifier: `${asin}-${Date.now()}` } } });
  return { normalized, catalog, pricing, fees: parseFees(feesRaw), restrictions: parseRestrictions(restrictionsRaw) };
}

export async function analyzeProfit(input, options = {}) {
  const normalized = validateProfitInput(input);
  const config = options.config ?? getSpApiConfig({ marketplace: normalized.marketplace.id });
  if (!options.client && config.missing.length) {
    return buildAnalysis(normalized, { auth: { status: 'missing_authorization', missingEnvironmentVariables: config.missing.map((k) => ({ clientId: 'SP_API_CLIENT_ID', clientSecret: 'SP_API_CLIENT_SECRET', refreshToken: 'SP_API_REFRESH_TOKEN', awsAccessKeyId: 'SP_API_AWS_ACCESS_KEY_ID', awsSecretAccessKey: 'SP_API_AWS_SECRET_ACCESS_KEY' }[k] ?? k)), guide: 'docs/profit-analyzer-sp-api-setup.md' } });
  }
  try { return buildAnalysis(normalized, await fetchSpApiAnalysis(normalized, { client: options.client })); }
  catch (error) { return buildAnalysis(normalized, { auth: { status: 'error', error: error.message, guide: 'docs/profit-analyzer-sp-api-setup.md' } }); }
}

function buildAnalysis(normalized, data = {}) {
  const catalog = data.catalog ?? null; const pricing = data.pricing ?? { missingData: ['sellingPrice'] }; const fees = data.fees ?? { missingData: ['estimatedAmazonFees'], errors: [] }; const restrictions = data.restrictions ?? null;
  const profitability = calculateProfitability({ sellingPrice: pricing.currentCompetitiveSellingPrice, estimatedAmazonFees: fees.totalEstimatedAmazonFees, purchaseCost: normalized.purchaseCost, inboundShipping: normalized.inboundShipping, prepCost: normalized.prepCost, minimumTargetRoi: normalized.minimumTargetRoi });
  const decision = decideProfitAnalysis({ profitability, restrictions, pricing, fees });
  if (data.auth?.status) { decision.decision = DECISIONS.NEEDS_REVIEW; decision.reasons.unshift(data.auth.status === 'missing_authorization' ? 'Amazon SP-API authorization is missing.' : 'Amazon SP-API request failed.'); decision.confidence = 20; }
  return { engine: '50toc-profit-analyzer-v1', generatedAt: new Date().toISOString(), source: 'Amazon Selling Partner API estimates', safety: { estimatesOnly: true, noCartActions: true, noListingCreation: true, noPurchases: true }, input: { asin: normalized.asin, marketplace: normalized.marketplace.id, purchaseCost: normalized.purchaseCost, fulfillmentMethod: normalized.fulfillmentMethod, inboundShipping: normalized.inboundShipping, minimumTargetRoi: normalized.minimumTargetRoi, prepCost: normalized.prepCost }, auth: data.auth ?? { status: 'authorized' }, catalog, pricing, fees, restrictions, profitability, decision };
}

export async function readInput(inputPath) {
  const parsed = JSON.parse(await readFile(inputPath, 'utf8'));
  if (parsed.asin || parsed.amazonAsin) return parsed;
  const discovery = parsed.discoveries?.find((d) => d.amazonProduct?.asin) ?? parsed.discoveries?.[0];
  if (discovery) return { ...discovery.sourceProduct, sourceProduct: discovery.sourceProduct, asin: discovery.amazonProduct?.asin, marketplace: parsed.marketplace ?? 'US' };
  throw new Error(`${inputPath} does not contain an ASIN or Amazon Product Discovery match.`);
}

export async function runProfitAnalyzer({ inputPath, outputPath = defaultOutputPath, ...input } = {}) {
  const sourceInput = input.asin || input.amazonAsin ? input : await readInput(inputPath ?? defaultInputPath);
  const analysis = await analyzeProfit(sourceInput);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(analysis, null, 2));
  return analysis;
}

function parseCli(argv) { const out = {}; for (let i=0;i<argv.length;i++) { const a=argv[i]; if (!a.startsWith('--')) { out.inputPath = path.resolve(a); continue; } const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()); out[key] = argv[i+1]?.startsWith('--') || argv[i+1] === undefined ? true : argv[++i]; } return out; }
export async function run(input = {}) { return runStandardizedModule({ id: 'profit-analyzer', name: '50TOC Profit Analyzer', inputFile: input.inputPath ?? defaultInputPath, outputFile: input.outputPath ?? defaultOutputPath, logFile: input.logFile ?? defaultExecutionLogPath, reportFile: input.reportFile ?? defaultExecutionReportPath }, async () => { const analysis = await runProfitAnalyzer(input); return { status: analysis.decision.decision === DECISIONS.BUY ? 'PASS' : 'WARNING', outputFile: input.outputPath ?? defaultOutputPath, processedItems: 1, warnings: analysis.decision.decision !== DECISIONS.BUY ? analysis.decision.reasons : [], data: { decision: analysis.decision } }; }); }

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseCli(process.argv.slice(2));
  const result = await runProfitAnalyzer(args);
  await run({ ...args, outputPath: args.outputPath ?? defaultOutputPath });
  console.log(`50TOC Profit Analyzer v1 complete: ${result.decision.decision}.`);
  console.log(`Wrote ${path.relative(repositoryRoot, args.outputPath ?? defaultOutputPath)}`);
}
