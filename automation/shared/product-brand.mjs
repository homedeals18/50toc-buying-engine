function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

const navigationOrPageCopyPattern = /\b(?:recipes?|buying guides?|shopping locations?|coupons?|add to cart|smart summary|ships free|snap ebt eligible|total sheets?|adhesive technology|extended value)\b/i;

export function sanitizeProductBrand(value) {
  const brand = clean(value);
  if (!brand || brand.length > 80) return null;
  if (navigationOrPageCopyPattern.test(brand)) return null;
  if (/^s\s+/i.test(brand)) return null;
  return brand;
}

export function hasTrustedProductBrand(value) {
  return Boolean(sanitizeProductBrand(value));
}
