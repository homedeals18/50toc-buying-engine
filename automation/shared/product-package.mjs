function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function canonicalUnit(value) {
  const unit = clean(value).toLowerCase().replaceAll('.', '');
  if (/^fl\s*oz$|^fluid\s*ounces?$/.test(unit)) return 'fl oz';
  if (/^oz$|^ounces?$/.test(unit)) return 'oz';
  if (/^(?:ct|count)$/.test(unit)) return 'ct';
  if (/^(?:pk|pack)$/.test(unit)) return 'pk';
  if (/^(?:pc|pcs|piece|pieces)$/.test(unit)) return 'pc';
  if (/^(?:lb|lbs|pound|pounds)$/.test(unit)) return 'lb';
  if (/^(?:gal|gallon|gallons)$/.test(unit)) return 'gal';
  if (/^(?:qt|quart|quarts)$/.test(unit)) return 'qt';
  if (/^(?:ml|milliliter|milliliters)$/.test(unit)) return 'ml';
  if (/^(?:l|liter|liters)$/.test(unit)) return 'L';
  return unit;
}

export function extractPackageSize(value) {
  const text = clean(value);
  if (!text) return null;
  const pattern = /\b(\d+(?:\.\d+)?)\s*[-/]?\s*(fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|ct|count|pk|pack|pcs?|pieces?|lbs?|pounds?|gallons?|gal|quarts?|qt|milliliters?|ml|liters?|l)\.?\b/gi;
  const matches = [...text.matchAll(pattern)].map((match) => `${match[1]} ${canonicalUnit(match[2])}`);
  return [...new Set(matches)].join(' / ') || null;
}

export function normalizePackageSize(value) {
  return extractPackageSize(value);
}
