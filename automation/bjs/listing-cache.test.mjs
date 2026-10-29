import test from 'node:test';
import assert from 'node:assert/strict';
import { startScan, reusableListingCache, RESUME_MAX_AGE_MS } from './listing-cache.mjs';

const now = Date.parse('2026-10-29T14:00:00Z');
const source = { name: 'Clearance' };
const previous = { scanId: 'scan-1', startedAt: new Date(now - 1000).toISOString(), completedAt: null, processedProductKeys: ['sku:1'], lastUrl: 'recovery-url' };
const cache = { scanId: 'scan-1', dealSource: 'Clearance', discoveredUrl: 'https://www.bjs.com/clearance', savedAt: new Date(now - 500).toISOString(), products: [{ sku: '1' }] };

test('normal scan resets old product skip keys and never reuses even recent cache', () => {
  const fresh = startScan(previous, { now });
  assert.notEqual(fresh.scanId, previous.scanId);
  assert.deepEqual(fresh.processedProductKeys, []);
  assert.equal(reusableListingCache(cache, source, fresh, { now }), false);
});

test('explicit recovery retains unfinished scan progress and its own recent listings', () => {
  const resumed = startScan(previous, { resume: true, now });
  assert.equal(resumed.scanId, previous.scanId);
  assert.deepEqual(resumed.processedProductKeys, ['sku:1']);
  assert.equal(resumed.lastUrl, 'recovery-url');
  assert.equal(reusableListingCache(cache, source, resumed, { now }), true);
});

test('completed expired future legacy and forced-refresh progress starts fresh', () => {
  for (const state of [
    { ...previous, completedAt: new Date(now).toISOString() },
    { ...previous, startedAt: new Date(now - RESUME_MAX_AGE_MS).toISOString() },
    { ...previous, startedAt: new Date(now + 1).toISOString() },
    { processedProductKeys: ['sku:1'] }
  ]) assert.equal(startScan(state, { resume: true, now }).resumed, false);
  assert.equal(startScan(previous, { resume: true, refresh: true, now }).resumed, false);
});

test('recovery rejects stale malformed foreign-source and foreign-scan caches', () => {
  const scan = startScan(previous, { resume: true, now });
  for (const patch of [
    { savedAt: 'invalid' }, { savedAt: new Date(now + 1).toISOString() },
    { savedAt: new Date(now - RESUME_MAX_AGE_MS).toISOString() },
    { savedAt: new Date(now - 2000).toISOString() },
    { scanId: 'old-scan' }, { scanId: undefined }, { dealSource: 'Wow Deals' },
    { discoveredUrl: 'https://example.com/clearance' }, { discoveredUrl: 'invalid' },
    { products: [] }, { products: {} }
  ]) assert.equal(reusableListingCache({ ...cache, ...patch }, source, scan, { now }), false, JSON.stringify(patch));
  assert.equal(reusableListingCache(cache, source, scan, { now, refresh: true }), false);
});
