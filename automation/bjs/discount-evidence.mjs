// Only labeled original prices qualify. The second dollar amount might be a
// unit price, coupon, shipping threshold or a recommendation, not a former price.
export function extractDiscountEvidence(text = '') {
  const money = '\\$\\s*\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?(?![\\d.])';
  const originalPrice = text.match(new RegExp(`\\b(?:was|original(?: price)?|regular(?: price)?|reg\\.?)\\s*:?\\s*(${money})`, 'i'))?.[1] ?? null;
  const discount = text.match(/\bsave\s*\$\s*\d+(?:\.\d{1,2})?(?![\d.])|(?<![\d.\-])\b\d+(?:\.\d+)?%\s*off\b/i)?.[0] ?? null;
  return { originalPrice, discount, coupon: null };
}
