import { randomUUID } from 'node:crypto';

export const RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function recent(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < RESUME_MAX_AGE_MS;
}

// Normal invocations always start fresh. Recovery is an explicit, bounded
// continuation of one unfinished scan, never reuse of arbitrary old listings.
export function startScan(previous = {}, { resume = false, refresh = false, now = Date.now() } = {}) {
  if (!previous || typeof previous !== 'object') previous = {};
  if (resume && !refresh && previous.scanId && !previous.completedAt && recent(previous.startedAt, now)) {
    return { ...previous, resumed: true };
  }
  return { scanId: randomUUID(), startedAt: new Date(now).toISOString(), completedAt: null, processedProductKeys: [], resumed: false };
}

export function reusableListingCache(cache, source, scan, { refresh = false, now = Date.now() } = {}) {
  if (refresh || !scan.resumed || cache?.scanId !== scan.scanId || cache?.dealSource !== source.name) return false;
  if (!recent(cache.savedAt, now) || Date.parse(cache.savedAt) < Date.parse(scan.startedAt)) return false;
  try {
    const url = new URL(cache.discoveredUrl);
    if (url.origin !== 'https://www.bjs.com') return false;
  } catch { return false; }
  return Array.isArray(cache.products) && cache.products.length > 0;
}
