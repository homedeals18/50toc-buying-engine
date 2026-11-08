# 50TOC — Jason Costco Research

First working Research module in Jason: React, a Node.js service, and PostgreSQL storage. All code is under this directory. The inherited frontend, Python backend, other extractors, and main branch are unchanged.

## Try it on Windows

The prepared Windows ZIP includes Node and the application dependencies. Extract the whole folder first, then double-click **START_DEMO.cmd** for synthetic examples, or **START_RESEARCH.cmd** for the live connector. No Python, Node installation, database installation, or package download is needed for that prepared ZIP.

Keep the service window open. Open the address printed there in your browser. The default is http://127.0.0.1:8876. Closing the browser does not stop a scan. Closing the service stops the application. After interruption, press **Resume incomplete scan**; paid calls never resume just because the application restarted.

Live setup: open **Settings / APIs**, paste the Scavio key, save it, and use **Test Connection** (the provider documents this as zero credits). No live key is included in the repository or ZIP. A server environment key takes precedence and cannot be changed through the screen.

## Development from this repository

Use Node 24 or newer. From this directory:

~~~sh
npm install
npm run build
npm test
npm run demo
# or, for the live connector:
npm start
~~~

For a locked pnpm install, use "pnpm install --frozen-lockfile". The committed pnpm lockfile pins the dependency tree. pnpm-workspace.yaml approves only esbuild's dependency build step.

## Research behavior

- Select warehouses, actual provider departments/subdepartments, and independent deal types. Multi-select and Select all are available. No product keyword is required.
- Markdown endings and sales share department reads. The service follows all supported pages (provider page range 1–500), not the clearance endpoint's 1–5-page sweep.
- Each department/warehouse starts at one task. Feed selections add tasks and use department membership to retain only matching products. The coupon book adds one shared task. The planner explains these before starting.
- At least 2 credits per US department/feed request and 1 for the coupon book, subject to the provider's current rates. Pagination and retries may add calls/cost. Warehouse and department lookup each cost 1 credit if uncached. Cache lifetime is 24 hours; observed times remain the original times.
- There is no arbitrary product cap and **no price ceiling**. UI pagination is display-only; exports include all saved offers for the selected scan/library, irrespective of display page or text filter.
- Selected .97/.00/.88/.49/.79/.89 endings derive from an identified warehouse price. An online price is never substituted. Special-buy endings are indicators, not proof of discount.
- Missing warehouse-price evidence is retained as Needs information when a selected markdown cannot be classified. Regular nonmatching items are omitted from collected deals, but each returned source page is retained in scan evidence.
- Provider categories and deal feeds only cover merchandise the provider can return. This does not establish complete physical warehouse inventory. Regular Costco is distinct from Costco Business Center delivery.
- Sale flags, coupon dates/scope, identifiers, source records and API photo/product links are preserved. UPC is optional and is never fabricated from a retailer SKU.
- Synthetic demo mode uses separate storage and never calls a network provider.

## Data and recovery

migrations/001_research.sql creates the isolated jason_research schema. Products, warehouse offers, per-scan offer snapshots, immutable raw source pages, department membership, corrections, cache and safe diagnostic events are separate.

Page evidence, saved offers and the next-page cursor commit in a single transaction. Failed pages can be retried. Cancelling saves the current successful request before stopping. Interrupted scans stay interrupted until explicitly resumed.

Rescans preserve first-seen dates and prior snapshots. Manual corrections have a separate table and survive rescans; the correction editing interface is deferred to Enrichment. Cached older responses cannot replace a newer current warehouse offer. Library offer history is available through the scan selector.

Exports: CSV with flattened nested fields (Excel-readable), and JSON with full records. Selecting a scan adds its original source pages to the JSON export. CSV guards against spreadsheet formula execution in provider text.

Default local storage is **PGlite**, an embedded PostgreSQL engine persisted in data/live/postgres or data/demo/postgres. It is a single-service local development option, not cross-device synchronization. Do not run two services against one embedded data directory.

For a full PostgreSQL server, provide DATABASE_URL through the server's secure environment. The same migration and parameterized queries are used. A dedicated PostgreSQL advisory lock prevents two Research workers against the same database. No database password or connection URL is returned to the browser. Do not put credentials in tracked files.

FIFTYTOC_DATA_DIR can select an explicit local data directory; PORT changes the local port. Copying an extracted ZIP does **not** automatically migrate existing prototype data. No existing installation, data or saved key is changed by this build.

## Connections and diagnostics

Encrypted Windows storage uses DPAPI for the current Windows account, passes the key to PowerShell via stdin, and treats it as a string throughout. A copied encrypted key will not necessarily work under another account/computer; re-enter it there. If DPAPI is unavailable in a restricted/automated logon context, the screen reports the encryption step failure and offers **This session only**. That option keeps the replacement key in process memory, never writes it to disk, and clears it on shutdown. An older encrypted key, if any, remains the persisted connection for the next start.

The Scavio connection test accepts numeric or strictly formatted numeric credit balances. Blank, malformed or changed response fields report a schema error with an event ID, not a false success or numeric-conversion exception.

Diagnostics retain operation, stage, event ID, status, duration and safe error code. Provider raw error bodies, headers, cookies, keys, arbitrary driver exceptions and connection strings are omitted. Successful provider records are redacted before storage. Account-specific cache keys are hashes.

This initial service binds to **127.0.0.1 only**, checks Host, Origin and an app-page session token, and serves bundled React assets with a Content Security Policy. It is a local development application, not multi-user authentication. Hosted sign-in, user roles, TLS, backups and remote access must be implemented before deployment. No Kamatera or other hosted service was changed.

## Verification boundaries

Automated tests use synthetic provider fixtures and the real embedded PostgreSQL engine. They cover multi-page/247-item scans, no price ceiling, scoping, retries, stop/resume, concurrency, transactional rollback, immutable history, stale-cache behavior, diagnostics, redaction, formatted credit balances, local API access checks, exports, disk persistence and memory-only key storage. The synthetic Windows DPAPI round-trip test explicitly skips if the automated logon context cannot encrypt. This occurred on the build machine; encrypted storage still requires an interactive test under the user's normal Windows account.

Browser checks use the synthetic demo. No real Scavio search, paid API call, Keepa/Amazon connection, retailer login or hosted PostgreSQL server was used. The external PostgreSQL driver path needs an integration run against the selected server. Actual provider response shape/coverage and available credits still require a user-run live pilot.

Enrichment/photo analysis, Amazon matching, ROI, human approvals, buying/worker operations, scheduling and SMS remain later modules. Sidebar entries mark that status explicitly. Research alone does not authorize purchases.

## Provider references checked for this implementation

- https://scavio.dev/docs/costco-category
- https://scavio.dev/docs/costco-categories
- https://scavio.dev/docs/costco-deals
- https://scavio.dev/docs/costco-coupons
- https://scavio.dev/docs/costco-warehouses
- https://scavio.dev/docs/usage
- https://pglite.dev/docs/
- https://node-postgres.com/features/transactions
