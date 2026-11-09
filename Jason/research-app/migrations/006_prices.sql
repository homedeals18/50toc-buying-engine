CREATE TABLE IF NOT EXISTS jason_research.warehouse_price_checks (
  offer_id TEXT PRIMARY KEY REFERENCES jason_research.offers(id),
  observed_at TIMESTAMPTZ NOT NULL,
  body JSONB NOT NULL
);
