export function normalizeBjsPrice(value) {
  if (value === undefined || value === null || value === '') return null;

  const compact = String(value).replace(/\s+/g, '').replace(/,/g, '');
  const numeric = compact.replace(/^\$/, '');

  if (/^\d+\.\d{1,2}$/.test(numeric)) {
    return `$${Number(numeric).toFixed(2)}`;
  }

  if (/^\d+$/.test(numeric)) {
    if (compact.startsWith('$') && numeric.length >= 3) {
      const dollars = numeric.slice(0, -2) || '0';
      const cents = numeric.slice(-2);
      return `$${Number(dollars)}.${cents}`;
    }
    return `$${Number(numeric).toFixed(2)}`;
  }

  return compact;
}
