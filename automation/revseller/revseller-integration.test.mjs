import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { amazonMatchQuery, extractAmazonProductFromPage, extractRevsellerFields, isAmazonProductPageUrl, readRevsellerPanel, saveRevsellerPanelTextArtifact } from './revseller-integration.mjs';

test('extracts RevSeller panel fields without calculating profitability', () => {
  const result = extractRevsellerFields({
    asin: 'B000000000',
    productTitle: 'Fallback title',
    productUrl: 'https://www.amazon.com/dp/B000000001',
    panelText: 'ASIN: B000000001 Product Title: Test Item Amazon Price: $19.99 FBA Fees: $5.32 Estimated Profit: $4.67 ROI: 31% BSR: 12,345 Category: Grocery Hazmat: No Meltable: Yes IP Alert: None Variation: No'
  });
  assert.equal(result.asin, 'B000000001');
  assert.equal(result.productTitle, 'Test Item');
  assert.equal(result.currentAmazonPrice, 19.99);
  assert.equal(result.sellingPrice, '$19.99');
  assert.equal(result.fbaFees, '$5.32');
  assert.equal(result.estimatedProfit, '$4.67');
  assert.equal(result.roi, '31%');
  assert.equal(result.hazmatWarning, 'No');
  assert.equal(result.meltableWarning, 'Yes');
  assert.equal(result.ipRestrictionWarnings, 'None');
  assert.equal(result.profitabilitySource, 'RevSeller');
});


test('prefers structured RevSeller DOM fields and keeps panel visibility consistent', () => {
  const result = extractRevsellerFields({
    asin: 'B000000002',
    productUrl: 'https://www.amazon.com/dp/B000000002',
    panelText: 'RevSeller profit calculator',
    panelFound: true,
    fields: {
      sellingPrice: '$24.99',
      fbaFees: '$6.12',
      estimatedProfit: '$7.44',
      roi: '42%',
      bsr: '8,765',
      category: 'Grocery & Gourmet Food',
      hazmatWarning: 'No hazmat warning',
      meltableWarning: 'Meltable',
      ipRestrictionWarnings: 'Restriction warning shown'
    }
  });

  assert.equal(result.revsellerPanelFound, true);
  assert.equal(result.sellingPrice, '$24.99');
  assert.equal(result.fbaFees, '$6.12');
  assert.equal(result.estimatedProfit, '$7.44');
  assert.equal(result.roi, '42%');
  assert.equal(result.bsr, '8,765');
  assert.equal(result.category, 'Grocery & Gourmet Food');
  assert.equal(result.hazmatWarning, 'No hazmat warning');
  assert.equal(result.meltableWarning, 'Meltable');
  assert.equal(result.ipRestrictionWarnings, 'Restriction warning shown');
});

test('parses captured 208-character live RevSeller panel text fixture', async () => {
  const fixturePath = path.join(import.meta.dirname, 'fixtures', 'live-panel-208.txt');
  const panelText = await readFile(fixturePath, 'utf8');
  assert.equal(panelText.length, 208);

  const result = extractRevsellerFields({
    panelText,
    productUrl: 'https://www.amazon.com/dp/B000TEST01',
    panelFound: true
  });

  assert.equal(result.revsellerPanelFound, true);
  assert.equal(result.asin, 'B000TEST01');
  assert.equal(result.sellingPrice, '$24.99');
  assert.equal(result.currentAmazonPrice, 24.99);
  assert.equal(result.fbaFees, '$5.67');
  assert.equal(result.estimatedProfit, '$7.89');
  assert.equal(result.roi, '45%');
  assert.equal(result.bsr, '12,345');
  assert.equal(result.category, 'Grocery & Gourmet Food');
  assert.equal(result.hazmatWarning, 'No');
  assert.equal(result.meltableWarning, 'No');
  assert.equal(result.ipRestrictionWarnings, 'None');
});

test('extracts fields from main-frame visible text candidates when panelText is not populated', () => {
  const result = extractRevsellerFields({
    panelText: '',
    panelFound: true,
    diagnostics: {
      visibleTextCandidates: [{
        text: 'Sell Price $18.49 FBA Fees $4.11 Estimated Profit $3.22 ROI 21% BSR 8,901 Category Health Hazmat No',
        textNodes: []
      }]
    }
  });

  assert.equal(result.sellingPrice, '$18.49');
  assert.equal(result.fbaFees, '$4.11');
  assert.equal(result.estimatedProfit, '$3.22');
  assert.equal(result.roi, '21%');
  assert.equal(result.bsr, '8,901');
  assert.equal(result.category, 'Health');
  assert.equal(result.meltableWarning, null);
  assert.equal(result.ipRestrictionWarnings, null);
});

test('saves raw live panel text exactly without joining text nodes', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'revseller-panel-text-'));
  const panelTextPath = path.join(tempRoot, 'revseller-panel-text.txt');
  const rawPanelText = 'Sell Price $18.49\nFBA Fees $4.11\nROI 21%';

  await saveRevsellerPanelTextArtifact({
    panelText: rawPanelText,
    panelTextNodes: ['Sell Price', '$18.49', 'FBA Fees', '$4.11', 'ROI', '21%']
  }, { panelTextPath });

  assert.equal(await readFile(panelTextPath, 'utf8'), rawPanelText);
});

test('builds reusable Amazon match query from connector product fields', () => {
  assert.equal(amazonMatchQuery({ brand: 'Brand', productName: 'Product', packageSize: '12 ct', count: '12 pack' }), 'Brand Product 12 ct 12 pack');
  assert.equal(amazonMatchQuery({ asin: 'B000000001' }), 'B000000001');
  assert.equal(amazonMatchQuery({ productUrl: 'https://www.costcobusinessdelivery.com/item' }), '');
});

test('maps Amazon page data into a matching candidate before RevSeller reads', () => {
  const candidate = extractAmazonProductFromPage({ asin: 'B000000001', title: 'Brand Product 12 ct', brand: 'Brand', upc: '000111222333', packageSize: '12 ct', count: '12 ct', price: '$19.99', productUrl: 'https://www.amazon.com/dp/B000000001' });
  assert.equal(candidate.asin, 'B000000001');
  assert.equal(candidate.title, 'Brand Product 12 ct');
  assert.equal(candidate.currentSellingPrice, '$19.99');
});


test('identifies opened Amazon product page URLs without navigating', () => {
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/dp/B000000001'), true);
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/Some-Product/dp/B000000001?th=1'), true);
  assert.equal(isAmazonProductPageUrl('https://www.amazon.com/s?k=test'), false);
});

test('prefers RevSeller visible text nodes found inside iframe render contexts', async () => {
  const page = {
    async waitForTimeout() {},
    frames() {
      return [
        { async evaluate() { return { panelText: '', panelTextNodes: [], fields: {}, panelFound: false }; } },
        {
          async evaluate() {
            return {
              asin: 'B000000003',
              productTitle: 'Iframe Product',
              productUrl: 'https://www.amazon.com/dp/B000000003',
              panelText: 'Amazon Price $21.99 FBA Fees $5.00 Estimated Profit $6.25 ROI 38%',
              panelTextNodes: ['Amazon Price', '$21.99', 'FBA Fees', '$5.00', 'Estimated Profit', '$6.25', 'ROI', '38%'],
              fields: {},
              panelFound: true,
              renderContexts: [{ isIframe: true, hasShadowRoot: false, score: 14 }]
            };
          }
        }
      ];
    }
  };

  const panel = await readRevsellerPanel(page);
  const data = extractRevsellerFields({ ...panel, panelFound: panel.panelFound });

  assert.deepEqual(panel.panelTextNodes, ['Amazon Price', '$21.99', 'FBA Fees', '$5.00', 'Estimated Profit', '$6.25', 'ROI', '38%']);
  assert.equal(panel.renderContexts[0].isIframe, true);
  assert.equal(data.currentAmazonPrice, 21.99);
  assert.equal(data.fbaFees, '$5.00');
  assert.equal(data.estimatedProfit, '$6.25');
  assert.equal(data.roi, '38%');
});

test('extracts current RevSeller layout from visible frame text', () => {
  const liveText = 'Rstr 252,958 in Toys & Games 2.71% 30d Sales -- Sell Price Buy Cost Net 6.56 8.82 Low FBA $19.29 0 Low FBM -- Buy Box $19.29 1 Amz --';
  const result = extractRevsellerFields({ panelText: 'chrome-extension://gobliffocflfaekfcaccndlffkhcafhb/html/comp-table.html', panelFound: true, frameDebug: [{ diagnostics: { visibleTextCandidates: [{ text: liveText, textNodes: [] }] } }] });
  assert.equal(result.currentAmazonPrice, 19.29);
  assert.equal(result.sellingPrice, '$19.29');
  assert.equal(result.bsr, '252,958');
  assert.equal(result.category, 'Toys & Games');
});
