CREATE TABLE IF NOT EXISTS jason_research.product_upcs (
  product_key TEXT PRIMARY KEY REFERENCES jason_research.products(id),
  revision INTEGER NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.upc_history (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id),
  revision INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL,
  UNIQUE(product_key,revision)
);
CREATE TABLE IF NOT EXISTS jason_research.identity_lookups (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id),
  observed_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.amazon_candidates (
  product_key TEXT NOT NULL REFERENCES jason_research.products(id), asin TEXT NOT NULL,
  revision INTEGER NOT NULL, body JSONB NOT NULL, PRIMARY KEY(product_key,asin)
);
CREATE TABLE IF NOT EXISTS jason_research.candidate_history (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id),
  asin TEXT NOT NULL, revision INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL,
  body JSONB NOT NULL, UNIQUE(product_key,asin,revision)
);
