const wantedCategoryPattern = /grocery|snacks?|candy|cookies?|crackers?|nuts?|beverages?|energy products?|shelf-stable food|health\s*&\s*beauty|health\s*&\s*household|personal care|household consumables?/i;

const rejectedDepartmentPattern = /\b(appliances?|kitchen[\s_-]+appliances?|home[\s_-]+appliances?|cookers?|slow[\s_-]+cookers?|multi[\s_-]+cookers?|blenders?|microwaves?|air[\s_-]+fryers?|air[\s_-]+purifiers?|toasters?|vacuums?|fans?|heaters?|refrigerators?|fridges?|mini[\s_-]+fridges?|freezers?|washers?|dryers?|coffee[\s_-]+makers?|mattress(?:es)?|sofas?|sectionals?|recliners?|chairs?|furniture|batter(?:y|ies)|electronics?|airpods|headphones?|nintendo|video[\s_-]+games?|consoles?|gaming|t\.?v\.?s?|televisions?|soundbars?|audio|patio[\s_-]+dining|patio|garden|outdoor[\s_-]+play|outdoor[\s_-]+furniture|outdoor|gazebos?|pergolas?|grill[\s_-]+accessor(?:y|ies)|grills?|spatulas?|deck[\s_-]+tiles?|dining[\s_-]+sets?|seating[\s_-]+sets?|lawn[\s_-]+games?|lawn[\s_-]+equipment|lawn|badminton|volleyball|power[\s_-]+equipment|toys?|clothing|apparel|automotive|seasonal[\s_-]+decorations?|seasonal|home[\s_-]+decor|jewelry|office[\s_-]+furniture|office|sporting[\s_-]+goods|books?|tires?)\b/i;

const rejectedBrandPattern = /\b(?:berkley\s+jensen|wellsley\s+farms|igloo|tineco)\b/i;
const rejectedHousewaresPattern = /\b(?:paper\s+plates?|dinner\s+plates?|oval\s+plates?|plates?|(?:folding\s+)?(?:acacia\s+)?wood\s+trays?|trays?|napkins?|food\s+storage|storage\s+(?:containers?|boxes?|bins?|totes?|organizers?)|organizers?|meal\s+prep\s+(?:sets?|containers?)|cookware|folding\s+tray|beverage\s+dispenser|water\s+bottles?|travel\s+mugs?|tumblers?|\bnuk\b|baby\s+bottles?|bassinets?|\blcg\s+florals\b|orchids?|ceramic\s+pots?|palmbrush|palmpeeler|humidifiers?|\bsterilite\b|latching\s+boxes?|fold(?:-|\s*)in(?:-|\s*)half\s+tables?|bumper\s+jumper|citrus\s+juicer|vegetable\s+choppers?|multifunctional\s+(?:vegetable\s+)?choppers?|coolers?|canopy\s+weights?|shelves|shelving|buckets?|hangers?|pillows?|dehumidifiers?|air\s+conditioners?|air\s+circulators?|kayaks?|pickleball|bath\s+rugs?|luggage|hardside\s+sets?|softside\s+luggage|suitcases?|backpacks?|smoke\s+(?:and\s+carbon\s+monoxide\s+)?alarms?|reusable\s+ice\s+blocks?|led\s+lights?|steel\s+racks?|life\s+vests?|paddle\s+pals|gift\s+cards?)\b/i;

const rejectedVarietyPattern = /\b(variety(?:\s+pack)?|assorted|assortment|mixed\s+(?:pack|variety|flavo[u]?r)|multi\s+flavo[u]?r|flavo[u]?r\s+variety|scent\s+mix|sampler)\b/i;

const frozenChilledPattern = /\b(frozen|refrigerated|chilled|meat|seafood|fish|dairy|produce|fresh fruit|fresh vegetables?|avocados?(?!\s+(?:oil|chips?|snacks?))|cherries|nectarines|seedless watermelon|organic bananas|fresh gourmet carrots|seedless green grapes|vidalia sweet onions|organic baby cut carrots|grape tomatoes|english seedless cucumbers|simply lemonade|pomegranate juice|little (?:yellows|potatoes?)|mandarins?|kiwi fruit|gold kiwi|baby spinach|organic whole garlic|cosmic crisp apples|broccoli florets|peaches|romaine lettuce|goldendew melon|fresh whole garlic|(?:bi-color seedless|seedless (?:red |green )?)grapes|flavor bombs cherry tomatoes|celery stalk|raspberries|mini watermelon)\b/i;
const repairOnlyRejectedNamePattern = /\b(?:air purifiers?|welch's 100% concord grape juice)\b/i;

const listingSignalFields = [
  ['product name', 'productName'],
  ['tile text', 'listingText'],
  ['product URL', 'productUrl'],
  ['image alt text', 'imageAltText'],
  ['category text', 'categoryText'],
  ['category text', 'category'],
  ['aria labels', 'ariaLabels'],
  ['breadcrumb/category metadata', 'breadcrumbText'],
  ['breadcrumb/category metadata', 'categoryMetadata']
];

function compact(value) {
  return value?.replace?.(/\s+/g, ' ').trim() || '';
}

function patternMatch(pattern, text) {
  pattern.lastIndex = 0;
  const match = text.match(pattern);
  return match?.[0] ? compact(match[0]) : null;
}

function firstSignalMatch(product, pattern) {
  for (const [signal, field] of listingSignalFields) {
    const value = compact(product[field]);
    const matched = patternMatch(pattern, value);
    if (matched) return { matched, signal };
  }
  return null;
}

export function normalizeProductKeyText(value) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function listingFilterText(product = {}) {
  return listingSignalFields.map(([, field]) => compact(product[field])).filter(Boolean).join(' | ');
}

export function evaluateListingProduct(product = {}) {
  const category = compact(product.category);
  const brandMatch = firstSignalMatch(product, rejectedBrandPattern);
  if (brandMatch) {
    return { accepted: false, reason: 'rejected-brand', ...brandMatch };
  }
  const housewaresMatch = firstSignalMatch(product, rejectedHousewaresPattern);
  if (housewaresMatch) {
    return { accepted: false, reason: 'rejected-housewares', ...housewaresMatch };
  }
  const varietyMatch = firstSignalMatch(product, rejectedVarietyPattern);
  if (varietyMatch) {
    return { accepted: false, reason: 'rejected-variety-assorted-sampler', ...varietyMatch };
  }
  const departmentMatch = firstSignalMatch(product, rejectedDepartmentPattern);
  if (departmentMatch) {
    return { accepted: false, reason: 'rejected-unrelated-department', ...departmentMatch };
  }
  const chilledMatch = firstSignalMatch(product, frozenChilledPattern);
  if (chilledMatch) {
    return { accepted: false, reason: 'rejected-frozen-chilled-fresh', ...chilledMatch };
  }
  if (category && wantedCategoryPattern.test(category)) {
    return { accepted: true, reason: 'accepted-relevant-category' };
  }
  return { accepted: true, reason: 'accepted-unknown-category' };
}

export function listingProductAllowed(product = {}) {
  return evaluateListingProduct(product).accepted;
}

export function categoryAllowed(product = {}) {
  const category = compact(product.category);
  const productText = compact([product.productName, product.brand, category].filter(Boolean).join(' '));
  if (rejectedBrandPattern.test(productText) || rejectedHousewaresPattern.test(productText)) return false;
  if (frozenChilledPattern.test(productText) || repairOnlyRejectedNamePattern.test(productText)) return false;
  if (!category) return true;
  return wantedCategoryPattern.test(category) && !rejectedDepartmentPattern.test(category);
}

export function normalizeProductUrl(value) {
  const raw = compact(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://www.bjs.com');
    url.hash = '';
    url.search = '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }
}

export function productIdentity(product = {}) {
  const upc = compact(product.upc);
  if (upc) return `upc:${upc}`;
  const sku = compact(product.sku);
  if (sku) return `sku:${sku}`;
  const url = normalizeProductUrl(product.productUrl);
  if (url) return `url:${url}`;
  return `name-size:${normalizeProductKeyText(product.productName)}:${normalizeProductKeyText(product.packageSize)}`;
}

export function mergeDuplicateProducts(products = []) {
  const byKey = new Map();
  let duplicatesMerged = 0;
  for (const product of products) {
    const key = productIdentity(product);
    const store = product.store ?? product.storeInfo ?? null;
    if (!byKey.has(key)) {
      byKey.set(key, { ...product, productIdentity: key, stores: store ? [store] : product.stores ?? [] });
      continue;
    }
    duplicatesMerged += 1;
    const existing = byKey.get(key);
    for (const [field, value] of Object.entries(product)) {
      if ((existing[field] === null || existing[field] === undefined || existing[field] === '') && value) existing[field] = value;
    }
    const stores = [...(existing.stores ?? []), ...(product.stores ?? []), ...(store ? [store] : [])];
    existing.stores = stores.filter((entry, index, all) => {
      const id = `${entry?.storeNumber ?? ''}:${entry?.storeName ?? ''}:${entry?.price ?? ''}`;
      return id !== '::' && all.findIndex((candidate) => `${candidate?.storeNumber ?? ''}:${candidate?.storeName ?? ''}:${candidate?.price ?? ''}` === id) === index;
    });
  }
  return { products: [...byKey.values()], duplicatesMerged };
}
