# 50TOC Buying Engine

Production-ready foundation for a modular buying engine built with FastAPI, React + TypeScript, PostgreSQL, SQLAlchemy, Alembic, Docker, and `.env` configuration.

## Architecture

- `backend/app/modules/*`: bounded backend modules for authentication, stores, products, UPC mapping, Amazon products, rule engine, buying plans, and purchase history.
- `backend/app/connectors/*`: isolated store connector packages. BJ's, Costco Business Center, Sam's Club, and Walmart placeholders exist for store integrations.
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


## Standard development pipeline

Run the full local development workflow from the repository root:

```bash
npm run dev:all
```

The development pipeline verifies the Git working tree, creates required artifact folders when needed, runs enabled store connectors, runs the Main Buying Engine, validates generated JSON artifacts, and prints a colored final summary. BJ's and Costco Business Center connectors are enabled by default. Disable either connector for a faster local run by setting `BJS_CONNECTOR_ENABLED=false` or `COSTCO_BUSINESS_CENTER_CONNECTOR_ENABLED=false`. Connector failures are reported in the final summary while the remaining workflow continues; the command exits non-zero only when the Main Buying Engine cannot complete.

## Store connectors

Store integrations should implement `StoreConnector` from `backend/app/connectors/base/client.py` inside their own connector package. Local Playwright automation currently exists for BJ's and Costco Business Center shopping-list intelligence workflows.

## Costco Business Center local automation

The Costco Business Center automation follows the finalized BJ's shopping-list architecture. It uses only <https://www.costcobusinessdelivery.com>, sets the delivery ZIP Code to `07601-6954` before scraping, searches for `Instant Savings`, enters the `All Online Instant Savings` section, and scrapes Instant Savings products only. The workflow prepares shopping-list artifacts for a 50TOC employee to purchase physically in store; it must not add products to cart, checkout, or place an order.

One-command setup:

```bash
./scripts/setup-costco-business-center-automation.sh
```

One-command Playwright run:

```bash
./scripts/run-costco-business-center-instant-savings-test.sh
```

The deal run keeps only allowed Costco Business Center categories: Grocery dry food, Candy & Snacks, Beverages, Health & Beauty, and Health & Household. It globally excludes fresh produce, meat, poultry, seafood, dairy, refrigerated and frozen products, bakery, deli, furniture, patio, garden, electronics, TV, appliances, clothing, toys, automotive, office, pet, and explicit variety-pack style products (`Variety Pack`, `Assorted`, `Assortment`, `Mixed Pack`, `Mixed Variety`, `Multi Flavor`, `Flavor Variety`, or `Sampler`). Flavor names that contain words like Fruity, Rainbow, Tropical, Summer, Berry, Peach, or Vibe are kept unless they clearly say variety, mixed, assorted, or sampler. It writes each product in the unified deal format (`supplier`, `dealSource`, `category`, `productName`, `brand`, `sku`, `upc`, `packageSize`, `currentPrice`, `originalPrice`, `discount`, `coupon`, `availability`, `quantityLimit`, `productUrl`, `imageUrl`, `scanDate`) to `artifacts/costco_business_center/logs/deal-products.json`, writes `artifacts/costco_business_center/logs/shopping-list-report.json`, and saves progress after every accepted product. Each run also writes `artifacts/costco_business_center/logs/costco-business-center-validation-summary.json` with the total products found, rejected products with rejection reasons, and final accepted products. A product is accepted only when required fields are populated: product name, current price, original price, savings amount, product URL, image URL, and SKU/item number. The connector is production-ready when that validation summary reports `production-ready`.

Use a testing limit when you want a short scrape:

```bash
COSTCO_BUSINESS_CENTER_MAX_INSTANT_SAVINGS_PRODUCTS=5 ./scripts/run-costco-business-center-instant-savings-test.sh
```

## Running tests

Run the backend unit tests from the repository root:

```bash
cd backend
python -m unittest discover -s tests
```

## BJ's local automation

The BJ's automation is a Playwright-based store shopping list intelligence workflow. It signs in when needed, visits only BJ's Clearance and Wow Deals, scrapes deal product data, and writes shopping-list artifacts for a 50TOC worker to purchase physically in store. The automation must not add items to cart, checkout, or place an order.

One-command setup:

```bash
./scripts/setup-bjs-automation.sh
```

One-command Playwright run:

```bash
./scripts/run-bjs-deals-test.sh
```

The setup script installs the BJ's automation Node dependencies, installs Chromium with Playwright's required system dependencies, and verifies that Chromium launches. The deal run collects only Clearance and Wow Deals products, keeps products in BJ's Grocery, Health & Beauty, and Health & Household categories when BJ's exposes category or filter data, and ignores unrelated departments such as furniture, patio, garden, outdoor, appliances, electronics, toys, clothing, automotive, and seasonal. It writes each product in the unified deal format (`supplier`, `dealSource`, `category`, `productName`, `brand`, `sku`, `upc`, `packageSize`, `currentPrice`, `originalPrice`, `discount`, `coupon`, `availability`, `quantityLimit`, `productUrl`, `imageUrl`, `scanDate`) to `artifacts/bjs/logs/deal-products.json`, writes a shopping-list-ready `artifacts/bjs/logs/shopping-list-report.json`, and saves progress after every scraped product so long runs can resume from the latest artifacts.

Use testing limits when you want a short scrape:

```bash
BJS_MAX_CLEARANCE_PRODUCTS=5 BJS_MAX_WOW_DEALS_PRODUCTS=5 ./scripts/run-bjs-deals-test.sh
```

For first-time authentication, run headed so you can complete BJ's login manually. The test waits up to 10 minutes by default for manual login. Override this with `BJS_MANUAL_LOGIN_TIMEOUT_MS` if needed. After login succeeds, Playwright saves the persistent profile under `artifacts/bjs/profile` and future Playwright-mode runs reuse that session when BJ's still accepts it.

### BJ's manual Chrome mode

Use manual Chrome mode when you want the BJ's workflow to attach to your already-running regular Chrome session. The runner never starts Chrome and never creates another Chrome window; it first checks that Chrome exposes the debugging endpoint, then runs the BJ's deal scraper inside that existing browser session. Start Chrome yourself with `--remote-debugging-port=9222` and sign in to BJ's in that browser before running the scraper.

Run from the repository root:

```bash
npm run scrape:bjs:deals:manual-chrome
```

If Windows reports a spawn `EINVAL` error through `npm`, use the direct Node launcher from the repository root. This bypasses `npx` and calls the local Playwright CLI with `process.execPath`:

```powershell
node automation/bjs/run-bjs-deals-manual-chrome.js
```

The manual script connects to `http://127.0.0.1:9222` by default; override it with `BJS_CHROME_CDP_ENDPOINT` if you use a different host or port. If Chrome was not started with remote debugging enabled, the script exits with setup instructions instead of launching Chrome or creating a dedicated profile. The normal Playwright launch mode remains available as the fallback with `./scripts/run-bjs-deals-test.sh`.

## RevSeller local integration

The RevSeller integration attaches to the operator's already-running regular Google Chrome session through CDP instead of launching a persistent profile. Configure the Chrome profile that already has Amazon logged in and the RevSeller extension installed and logged in, then start that same Chrome session with `--remote-debugging-port=9222` before running automation:

```bash
export AMAZON_CHROME_PATH="/path/to/google-chrome"
export AMAZON_CHROME_USER_DATA_DIR="$HOME/.config/google-chrome"
export AMAZON_CHROME_PROFILE_DIRECTORY="Default"
```

Windows PowerShell setup:

```powershell
$env:AMAZON_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:AMAZON_CHROME_USER_DATA_DIR = "C:\Users\Nir\AppData\Local\Google\Chrome\User Data"
$env:AMAZON_CHROME_PROFILE_DIRECTORY = "Default"
npm run read:revseller
```

To find the correct Windows values, open `chrome://version` in the exact Chrome profile that has RevSeller installed. Use **Executable Path** for `AMAZON_CHROME_PATH`. Split **Profile Path** so the parent `User Data` folder becomes `AMAZON_CHROME_USER_DATA_DIR` and the final folder name, such as `Default` or `Profile 1`, becomes `AMAZON_CHROME_PROFILE_DIRECTORY`. Start that existing Chrome session with `--remote-debugging-port=9222` and set `AMAZON_CHROME_CDP_ENDPOINT` if you use a non-default endpoint. The session manager connects to the existing debuggable Chrome session or fails clearly, and never launches Chrome, creates a second window, or creates a temporary profile.

Run the RevSeller authenticated Amazon analysis from the repository root:

```bash
npm run scrape:revseller
```

Before analysis starts, the Amazon browser session manager inspects the configured Chrome profile's `Extensions` directory and logs detected extension IDs and names while looking for RevSeller by manifest/name/content signals. If profile inspection does not find RevSeller, it attaches to the existing CDP-enabled Chrome session, opens an Amazon product page in that session, and checks the live page DOM for RevSeller. The run stops with `RevSeller extension is not available in the configured Chrome profile.` only when both profile inspection and live-page verification fail. The automation reuses the configured profile's cookies and existing Amazon/RevSeller sessions; it does not log in automatically, create a temporary profile, add to cart, or purchase.

Authenticated RevSeller data is read only after the session check succeeds. The module is independent from BJ's, Costco, Sam's Club, and the Main Buying Engine. Future connectors can pass product records through a JSON file path, and the module will match each record to Amazon using `amazonUrl`, `productUrl`, `url`, `asin`, `upc`, or the combined `brand productName packageSize` fields:

```bash
REVSELLER_CONNECTOR_PRODUCTS_PATH="artifacts/some_connector/logs/deal-products.json" npm run scrape:revseller
```

For direct product-page analysis, provide comma-separated Amazon product URLs:

```bash
REVSELLER_AMAZON_PRODUCT_URLS="https://www.amazon.com/dp/XXXXXXXXXX,https://www.amazon.com/dp/YYYYYYYYYY" npm run scrape:revseller
```

The integration reads profitability values from the RevSeller panel and does not calculate profitability manually when RevSeller data exists. It extracts ASIN, product title, current Amazon price, FBA fees, estimated profit, ROI, BSR, category, hazmat, meltable, IP alert, and variation fields when shown, then writes the sanitized report to `artifacts/amazon/revseller-analysis-report.json`. Auth status metadata remains under `artifacts/revseller/logs`; credentials, cookies, session state, logs, and generated reports are ignored by Git so secrets are not committed.
