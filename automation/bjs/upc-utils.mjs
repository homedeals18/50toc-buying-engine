function digits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidGtin(value) {
  const code = digits(value);
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const values = [...code].map(Number);
  const checkDigit = values.pop();
  let sum = 0;
  for (let index = values.length - 1, position = 0; index >= 0; index -= 1, position += 1) {
    sum += values[index] * (position % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === checkDigit;
}

export function normalizeGtin(value) {
  const code = digits(value);
  return isValidGtin(code) ? code : null;
}

function collectFromObject(value, results, seen) {
  if (value === null || value === undefined || seen.has(value)) return;
  if (typeof value !== 'object') return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectFromObject(entry, results, seen);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:gtin(?:8|12|13|14)?|upc|upca|ean|barcode)$/i.test(key)) {
      const normalized = normalizeGtin(entry);
      if (normalized) results.add(normalized);
    }
    collectFromObject(entry, results, seen);
  }
}

export function extractGtinCandidatesFromObject(value) {
  const results = new Set();
  collectFromObject(value, results, new Set());
  return [...results].sort((left, right) => Math.abs(left.length - 12) - Math.abs(right.length - 12));
}

export function extractLabeledGtinCandidates(text) {
  const source = String(text ?? '');
  const results = new Set();
  const pattern = /(?:gtin(?:8|12|13|14)?|upc(?:-?a)?|ean|barcode)\s*["']?\s*[:=#-]\s*["']?([0-9][0-9\s-]{6,20}[0-9])/gi;
  for (const match of source.matchAll(pattern)) {
    const normalized = normalizeGtin(match[1]);
    if (normalized) results.add(normalized);
  }
  return [...results].sort((left, right) => Math.abs(left.length - 12) - Math.abs(right.length - 12));
}

export function extractGtinCandidatesNearIdentity(text, identities = []) {
  const source = String(text ?? '');
  const normalizedIdentities = identities.map((value) => String(value ?? '').trim()).filter(Boolean);
  const windows = [];
  for (const identity of normalizedIdentities) {
    let index = source.toLowerCase().indexOf(identity.toLowerCase());
    while (index >= 0) {
      windows.push(source.slice(Math.max(0, index - 2500), Math.min(source.length, index + identity.length + 2500)));
      index = source.toLowerCase().indexOf(identity.toLowerCase(), index + identity.length);
    }
  }
  return [...new Set(windows.flatMap(extractLabeledGtinCandidates))];
}
