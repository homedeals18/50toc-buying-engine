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

The BJ's automation is a Playwright-based local end-to-end workflow for validating the authenticated Blue Diamond Almonds shopping path. By default, it launches a Playwright-managed persistent Chromium profile and reuses that session on future runs. For BJ's troubleshooting, it can also connect to an already-open regular Chrome browser through Chrome remote debugging and reuse that manual Chrome session instead.

One-command setup:

```bash
./scripts/setup-bjs-automation.sh
```

One-command run:

```bash
./scripts/run-bjs-blue-diamond-test.sh
```

The setup script installs the BJ's automation Node dependencies, installs Chromium with Playwright's required system dependencies, and verifies that Chromium launches. The run script verifies browser launch again, runs the Blue Diamond Almonds test, searches for `Blue Diamond Almonds 0.75 oz`, opens the first matching product, extracts product name/SKU/UPC/price/availability/quantity limits/coupons/package size, adds one item to the cart, verifies the cart, and stops before checkout without placing an order. If BJ's returns an Access Denied page at any step, the test saves artifacts and stops with a clear error. Screenshots, product details, and the complete execution report are written under `artifacts/bjs/`.

For first-time authentication, run headed so you can complete BJ's login manually:

```bash
BJS_HEADLESS=false ./scripts/run-bjs-blue-diamond-test.sh
```

The test waits up to 10 minutes by default for manual login. Override this with `BJS_MANUAL_LOGIN_TIMEOUT_MS` if needed. After login succeeds, Playwright saves the persistent profile under `artifacts/bjs/profile` and future Playwright-mode runs reuse that session when BJ's still accepts it.

### BJ's manual Chrome mode

Use manual Chrome mode when you want the BJ's workflow to reuse a regular Chrome window that you opened yourself. Start Chrome with remote debugging enabled and a dedicated profile folder, sign in to BJ's in that window if needed, and then run the manual Chrome script.

Windows PowerShell example:

```powershell
$profile = "$env:USERPROFILE\bjs-manual-chrome-profile"
& "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$profile" https://www.bjs.com
```

If Chrome is installed in the 32-bit Program Files location, use this path instead:

```powershell
& "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$profile" https://www.bjs.com
```

Leave that Chrome window open, then run from the repository root:

```bash
npm run test:blue-diamond:manual-chrome
```

The manual script connects to `http://127.0.0.1:9222` by default. Override it with `BJS_CHROME_CDP_ENDPOINT` if you use a different host or port. The normal Playwright launch mode remains available as the fallback with `npm run test:blue-diamond:headed` or `./scripts/run-bjs-blue-diamond-test.sh`.
