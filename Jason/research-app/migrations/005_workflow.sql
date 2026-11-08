CREATE TABLE IF NOT EXISTS jason_research.accounts (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('manager','worker')),
  active BOOLEAN NOT NULL DEFAULT TRUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.logins (
  token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES jason_research.accounts(id), expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.workflow_items (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id), asin TEXT NOT NULL,
  revision INTEGER NOT NULL, body JSONB NOT NULL, UNIQUE(product_key,asin)
);
CREATE TABLE IF NOT EXISTS jason_research.analysis_history (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES jason_research.workflow_items(id), created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.buying_targets (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id), revision INTEGER NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.unit_reservations (
  target_id TEXT NOT NULL REFERENCES jason_research.buying_targets(id), worker_id TEXT NOT NULL,
  units INTEGER NOT NULL CHECK(units>=0), PRIMARY KEY(target_id,worker_id)
);
CREATE TABLE IF NOT EXISTS jason_research.purchases (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, target_id TEXT NOT NULL REFERENCES jason_research.buying_targets(id),
  worker_id TEXT NOT NULL, bought_at TIMESTAMPTZ NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
  paid_payment_id TEXT, revision INTEGER NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.payments (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, worker_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.payment_adjustments (
  id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, purchase_id TEXT NOT NULL REFERENCES jason_research.purchases(id), body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.product_blocks (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id), asin TEXT, active BOOLEAN NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.worker_submissions (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, worker_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.receipts (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, content BYTEA NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.receipt_links (
  receipt_id TEXT NOT NULL REFERENCES jason_research.receipts(id), purchase_id TEXT NOT NULL REFERENCES jason_research.purchases(id),
  PRIMARY KEY(receipt_id,purchase_id)
);
CREATE TABLE IF NOT EXISTS jason_research.workflow_audit (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.catalog_lookups (
  id TEXT PRIMARY KEY, product_key TEXT NOT NULL REFERENCES jason_research.products(id), observed_at TIMESTAMPTZ NOT NULL, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.visit_plans (
  id TEXT PRIMARY KEY, body JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS jason_research.submission_files (
  submission_id TEXT NOT NULL REFERENCES jason_research.worker_submissions(id), receipt_id TEXT NOT NULL REFERENCES jason_research.receipts(id),
  PRIMARY KEY(submission_id,receipt_id)
);
