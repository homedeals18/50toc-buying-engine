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

Use manual Chrome mode when you want the BJ's workflow to reuse a regular Chrome window. The launcher starts regular Google Chrome with remote debugging enabled, waits for Chrome to expose the debugging endpoint, and then runs the Blue Diamond Almonds Playwright test against that Chrome session. Sign in to BJ's in the launched Chrome window if prompted.

Run from the repository root:

```bash
npm run test:blue-diamond:manual-chrome
```

On Windows, the launcher uses `child_process.spawn` directly with the Chrome executable path. It checks the default 64-bit Chrome install first and then the 32-bit and per-user installs:

- `%ProgramFiles%\Google\Chrome\Application\chrome.exe`
- `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`
- `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`

If Chrome is installed somewhere else, set `BJS_CHROME_PATH` in PowerShell before running the test:

```powershell
$env:BJS_CHROME_PATH = "D:\Apps\Google\Chrome\Application\chrome.exe"
npm run test:blue-diamond:manual-chrome
```

The launcher stores the dedicated manual Chrome profile under `artifacts/bjs/manual-chrome-profile` by default. Override it with `BJS_MANUAL_CHROME_PROFILE_DIR` if you want to reuse a different profile folder. The manual script connects to `http://127.0.0.1:9222` by default; override it with `BJS_CHROME_CDP_ENDPOINT` if you use a different host or port. To connect to a Chrome instance that you already started yourself, set `BJS_SKIP_CHROME_LAUNCH=true` and make sure that Chrome was started with a matching `--remote-debugging-port`. The normal Playwright launch mode remains available as the fallback with `npm run test:blue-diamond:headed` or `./scripts/run-bjs-blue-diamond-test.sh`.
