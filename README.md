# 50TOC Buying Engine

Production-ready foundation for a modular buying engine built with FastAPI, React + TypeScript, PostgreSQL, SQLAlchemy, Alembic, Docker, and `.env` configuration.

## Architecture

- `backend/app/modules/*`: bounded backend modules for authentication, stores, products, UPC mapping, Amazon products, rule engine, buying plans, and purchase history.
- `backend/app/connectors/*`: isolated store connector packages. BJ's, Costco Business Center, Sam's Club, and Walmart placeholders exist but are intentionally not implemented.
- `backend/app/db` and `backend/app/models`: SQLAlchemy session, base metadata, and initial domain models.
- `backend/alembic`: migration environment and initial schema migration.
- `frontend/src`: React + TypeScript application shell.

## Getting started

1. Copy environment defaults:

   ```bash
   cp .env.example .env
   ```

2. Start the stack:

   ```bash
   docker compose up --build
   ```

3. Run migrations:

   ```bash
   docker compose exec backend alembic upgrade head
   ```

4. Open the apps:

   - Frontend: <http://localhost:5173>
   - Backend docs: <http://localhost:8000/docs>
   - Health check: <http://localhost:8000/health>

## Local backend development

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

## Local frontend development

```bash
cd frontend
npm install
npm run dev
```

## Store connectors

Store integrations should implement `StoreConnector` from `backend/app/connectors/base/client.py` inside their own connector package. The placeholder packages are reserved for future BJ's, Costco Business Center, Sam's Club, and Walmart implementations.

## Running tests

Run the backend unit tests from the repository root:

```bash
cd backend
python -m unittest discover -s tests
```

## BJ's local automation

The BJ's automation is a Playwright-based local end-to-end workflow for validating the authenticated Blue Diamond Almonds shopping path. It reuses a saved BJ's browser session when `artifacts/bjs/storage/bjs-auth-state.json` exists; otherwise it opens BJ's and waits for a one-time manual login before saving that browser state for future runs.

One-command setup:

```bash
./scripts/setup-bjs-automation.sh
```

One-command run:

```bash
./scripts/run-bjs-blue-diamond-test.sh
```

The setup script installs the BJ's automation Node dependencies, installs Chromium with Playwright's required system dependencies, and verifies that Chromium launches. The run script verifies browser launch again, runs the Blue Diamond Almonds test, searches for `Blue Diamond Almonds 0.75 oz`, opens the first matching product, extracts product name/SKU/UPC/price/availability/quantity limits/coupons/package size, adds one item to the cart, verifies the cart, and stops before checkout without placing an order. Screenshots, product details, and the complete execution report are written under `artifacts/bjs/`.

For first-time authentication, run headed so you can complete BJ's login manually:

```bash
BJS_HEADLESS=false ./scripts/run-bjs-blue-diamond-test.sh
```

The test waits up to 10 minutes by default for manual login. Override this with `BJS_MANUAL_LOGIN_TIMEOUT_MS` if needed. After login succeeds, Playwright saves `artifacts/bjs/storage/bjs-auth-state.json` and future runs reuse that session when BJ's still accepts it.
