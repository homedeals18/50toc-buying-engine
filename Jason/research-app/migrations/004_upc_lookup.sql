CREATE TABLE IF NOT EXISTS jason_research.upc_lookup_reports (
  job_id TEXT NOT NULL, product_key TEXT NOT NULL REFERENCES jason_research.products(id),
  observed_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL, PRIMARY KEY(job_id,product_key)
);
CREATE INDEX IF NOT EXISTS upc_lookup_product_date ON jason_research.upc_lookup_reports(product_key,observed_at DESC);
