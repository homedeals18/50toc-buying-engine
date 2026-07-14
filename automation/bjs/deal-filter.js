const wantedCategoryPattern = /grocery|snacks?|candy|cookies?|crackers?|nuts?|beverages?|energy products?|shelf-stable food|health\s*&\s*beauty|health\s*&\s*household|personal care|household consumables?/i;

const rejectedDepartmentPattern = /furniture|patio|garden|outdoor furniture|gazebos?|pergolas?|grills?|lawn equipment|power equipment|electronics?|\btv\b|\btvs\b|audio|appliances?|mattresses?|toys?|clothing|automotive|seasonal decorations?|home decor|jewelry|office furniture|sporting goods|books?|tires?/i;

const rejectedVarietyPattern = /\b(variety(?:\s+pack)?|assorted|assortment|mixed\s+(?:pack|variety|flavo[u]?r)|multi\s+flavo[u]?r|flavo[u]?r\s+variety|sampler)\b/i;

const frozenChilledPattern = /\b(frozen|refrigerated|chilled|meat|seafood|fish|dairy|produce|fresh fruit|fresh vegetables?)\b/i;

function compact(value) {
  return value?.replace?.(/\s+/g, ' ').trim() || '';
}

export function normalizeProductKeyText(value) {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function listingFilterText(product = {}) {
  return [
    product.productName,
    product.category,
    product.listingText,
    product.productUrl
  ].map(compact).filter(Boolean).join(' | ');
}

export function evaluateListingProduct(product = {}) {
  const text = listingFilterText(product);
  const category = compact(product.category);
  if (rejectedVarietyPattern.test(text)) {
    return { accepted: false, reason: 'rejected-variety-assorted-sampler' };
  }
  if (rejectedDepartmentPattern.test(text)) {
    return { accepted: false, reason: 'rejected-unrelated-department' };
  }
  if (frozenChilledPattern.test(text)) {
    return { accepted: false, reason: 'rejected-frozen-chilled-fresh' };
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
  if (!category) return true;
  return wantedCategoryPattern.test(category) && !rejectedDepartmentPattern.test(category) && !frozenChilledPattern.test(category);
}

export function productIdentity(product = {}) {
  const upc = compact(product.upc);
  if (upc) return `upc:${upc}`;
  const sku = compact(product.sku);
  if (sku) return `sku:${sku}`;
  const url = compact(product.productUrl)?.split('?')[0];
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
