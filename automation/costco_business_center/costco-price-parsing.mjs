export function costcoPriceParsingSource() {
  return String.raw`
    function normalizeCostcoMoney(value) {
      if (value === null || value === undefined) return null;
      let raw = String(value).replace(/\u00a0/g, ' ').trim();
      if (!raw) return null;
      raw = raw.replace(/\s+/g, ' ');
      const explicitDecimal = raw.match(/\$?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*\.\s*(\d{2})\b/);
      if (explicitDecimal) return '$' + explicitDecimal[1].replace(/,/g, '') + '.' + explicitDecimal[2];
      const splitCents = raw.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)\s+(\d{2})\b/);
      if (splitCents) return '$' + splitCents[1].replace(/,/g, '') + '.' + splitCents[2];
      const whole = raw.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)\b(?![,.]|\s*(?:\.|\d{2}\b))/);
      if (whole) {
        const amount = whole[1].replace(/,/g, '');
        if (!whole[1].includes(',') && /^\d{3,4}$/.test(amount)) return '$' + amount.slice(0, -2) + '.' + amount.slice(-2);
        return '$' + amount + '.00';
      }
      const numeric = raw.match(/^(\d+)(?:\.(\d{1,2}))?$/);
      if (numeric) {
        if (!numeric[2] && /^\d{3,4}$/.test(numeric[1])) return '$' + numeric[1].slice(0, -2) + '.' + numeric[1].slice(-2);
        return '$' + numeric[1] + '.' + (numeric[2] || '00').padEnd(2, '0');
      }
      return null;
    }

    function costcoMoneyToNumber(value) {
      const normalized = normalizeCostcoMoney(value);
      if (!normalized) return null;
      const numeric = Number(String(normalized).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(numeric) ? numeric : null;
    }
    function formatCostcoMoney(value) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? '$' + numeric.toFixed(2) : null;
    }
    function extractCostcoCouponDiscount(text) {
      const source = String(text || '').replace(/\u00a0/g, ' ');
      const match = source.match(/(?:save|instant\s+savings)\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?)/i);
      return match ? normalizeCostcoMoney('$' + match[1]) : null;
    }
    function extractCostcoOriginalPrice(text) {
      const source = String(text || '').replace(/\u00a0/g, ' ');
      const match = source.match(/\bwas\s*(\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?)/i)
        || source.match(/\boriginal(?:\s+price)?\s*(\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?)/i);
      return match ? normalizeCostcoMoney(match[1]) : null;
    }
    function calculateCostcoInstantSavingsPrice(text, displayedPrice = null) {
      const originalPrice = extractCostcoOriginalPrice(text);
      const couponDiscount = extractCostcoCouponDiscount(text);
      const original = costcoMoneyToNumber(originalPrice);
      const coupon = costcoMoneyToNumber(couponDiscount);
      const displayed = costcoMoneyToNumber(displayedPrice);
      if (original !== null && coupon !== null) {
        const discounted = Math.max(0, Math.round((original - coupon) * 100) / 100);
        const finalPurchasePrice = displayed !== null && Math.abs(displayed - discounted) < 0.01 ? displayed : discounted;
        return { originalPrice, couponDiscount, finalPurchasePrice: formatCostcoMoney(finalPurchasePrice) };
      }
      return { originalPrice: originalPrice ?? null, couponDiscount: couponDiscount ?? null, finalPurchasePrice: displayed !== null ? formatCostcoMoney(displayed) : null };
    }
    function extractCostcoPrices(text) {
      const source = String(text || '').replace(/\u00a0/g, ' ');
      const pricePattern = /\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?\b/g;
      const found = [];
      for (const match of source.matchAll(pricePattern)) {
        const normalized = normalizeCostcoMoney(match[0]);
        if (normalized && !found.includes(normalized)) found.push(normalized);
      }
      return found;
    }
    function extractCostcoDiscount(text) {
      const source = String(text || '').replace(/\u00a0/g, ' ');
      const match = source.match(/(?:instant\s+savings|save\s*(?:\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?|\$?\s*\d+(?:\.\d{2})?)|\d+\s*%\s*off)/i);
      return match ? match[0].replace(/\s+/g, ' ').trim().replace(/\$\s*(\d[\d,]*)\s+(\d{2})\b/g, '$$$1.$2') : null;
    }
    function extractCostcoCoupon(text) {
      const source = String(text || '').replace(/\u00a0/g, ' ');
      const match = source.match(/(?:instant savings|coupon|clip|save\s*(?:\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\s*\.\s*\d{2}|\s+\d{2})?|\$?\s*\d+))[\s\S]{0,120}/i);
      return match ? match[0].replace(/\s+/g, ' ').trim().replace(/\$\s*(\d[\d,]*)\s+(\d{2})\b/g, '$$$1.$2') : null;
    }
  `;
}
