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

The BJ's automation is a Playwright-based local workflow for validating the Blue Diamond Almonds shopping path and saving reproducible artifacts.

One-command setup:

```bash
./scripts/setup-bjs-automation.sh
```

One-command run:

```bash
./scripts/run-bjs-blue-diamond-test.sh
```

The setup script installs the BJ's automation Node dependencies, installs Chromium with Playwright's required system dependencies, and verifies that Chromium launches. The run script verifies browser launch again, runs the Blue Diamond Almonds test, and writes screenshots and logs under `artifacts/bjs/`.
