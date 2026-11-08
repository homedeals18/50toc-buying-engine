CREATE SCHEMA IF NOT EXISTS jason_research;
CREATE TABLE IF NOT EXISTS jason_research.settings (key TEXT PRIMARY KEY, body JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS jason_research.scans (
  id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS jason_research.products (
  id TEXT PRIMARY KEY, retailer TEXT NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.offers (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES jason_research.products(id),
  warehouse_id TEXT NOT NULL, first_seen TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.scan_offers (
  scan_id TEXT NOT NULL REFERENCES jason_research.scans(id),
  offer_id TEXT NOT NULL REFERENCES jason_research.offers(id), body JSONB NOT NULL,
  PRIMARY KEY(scan_id,offer_id)
);
-- Append-only source evidence: later scans and enrichment never rewrite earlier pages.
CREATE TABLE IF NOT EXISTS jason_research.source_pages (
  id BIGSERIAL PRIMARY KEY, scan_id TEXT NOT NULL REFERENCES jason_research.scans(id),
  task_id TEXT NOT NULL, page INTEGER NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
  cached BOOLEAN NOT NULL, body JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS source_pages_scan_idx ON jason_research.source_pages(scan_id);
CREATE TABLE IF NOT EXISTS jason_research.membership (
  scan_id TEXT NOT NULL REFERENCES jason_research.scans(id), warehouse_id TEXT NOT NULL,
  alias TEXT NOT NULL, category_id TEXT NOT NULL, body JSONB NOT NULL,
  PRIMARY KEY(scan_id,warehouse_id,alias,category_id)
);
-- Future enrichment/corrections have separate ownership from provider facts.
CREATE TABLE IF NOT EXISTS jason_research.corrections (
  offer_id TEXT PRIMARY KEY REFERENCES jason_research.offers(id), body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.cache (
  key TEXT PRIMARY KEY, observed_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.diagnostics (
  id TEXT PRIMARY KEY, utc TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
