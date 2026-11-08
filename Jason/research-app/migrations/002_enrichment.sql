CREATE TABLE IF NOT EXISTS jason_research.enrichment_profiles (
  product_key TEXT PRIMARY KEY REFERENCES jason_research.products(id),
  revision INTEGER NOT NULL,
  source_signature TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.enrichment_history (
  id TEXT PRIMARY KEY,
  product_key TEXT NOT NULL REFERENCES jason_research.products(id),
  revision INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,
  body JSONB NOT NULL,
  UNIQUE(product_key, revision)
);
CREATE INDEX IF NOT EXISTS enrichment_history_product_idx ON jason_research.enrichment_history(product_key,revision);
