# 50TOC — Jason Research Enrichment and Exact Matching 0.3

Costco Research, product Enrichment and the first exact-match stage in Jason: React, a Node.js service, and PostgreSQL storage. All code is under this directory. The inherited matching engine is not used by the new exact matcher. The inherited application directories and main branch remain unchanged.

## Try it on Windows

The prepared Windows ZIP includes Node and the application dependencies. Extract the whole folder first, then double-click **START_RESEARCH.cmd** for real Scavio searches. **START_DEMO.cmd** is optional and shows synthetic example products and warehouses. No Python, Node installation, database installation, or package download is needed for that prepared ZIP.

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

## Enrichment and review

Saved Research products receive local title-based suggestions automatically, including existing products on startup. No Scavio, model, photo-download or other paid call is made by this stage.

The review screen separates product name, product type/form, containers per club package, container type, contents per container, total contents, size amount/unit/basis, flavor, scent, variant, strength and variety-pack status. Brand and UPC remain source facts. It never assumes a missing club package count is one. A capsule/tablet count is not a count of bottles; ambiguous per-container versus total counts stay unresolved.

API facts and exact title evidence remain visible alongside editable values and individual review states. Conflicting values stay unknown until the reviewer resolves them. The size basis inferred from title layout is labeled and requires human review. All extraction is conservative rules, not a general AI interpretation of arbitrary titles.

Save draft retains work without confirming it. Confirm reviewed fields records the human review; incomplete records become Reviewed with gaps. A fully reviewed identity is not a purchase approval and does not trigger Amazon matching. Corrections outside source suggestions or conflicts require a short explanatory note. The reviewer name is a local history label, not an authenticated identity.

One enrichment record is shared across warehouse offers for a club product. Profiles and append-only revision history are separate from original Research data. Price/timestamp-only rescans do not invalidate identity review. Title, package facts, UPC, image-link or other identity changes retain corrections and mark them for recheck. Optimistic revision checks and product-row locks prevent silent concurrent overwrites. Browser edits stay in the mounted review when navigating between sidebar modules; reloading/closing warns about unsaved work.

Photo analysis is explicitly disconnected. API photo links are available for manual viewing, but the app does not download or interpret images in this release. Enrichment CSV/JSON exports include field review states and evidence. See UPGRADE_FROM_0_1.txt before reusing existing Jason data; migration 002 adds tables without replacing Research or legacy corrections.

## Exact matching first and UPC evidence

The first matching stage compares only the exact product and package. It preserves multiple child-ASIN candidates and does not choose a single highest-scoring result. A separately developed broader-search or alternate-pack engine is deferred; Potential matches is a holding tab for supplied candidates that do not qualify as exact.

Primary exact matching requires verified full-package UPC/GTIN evidence on both sides and reviewed package facts. Brand, count, size/basis, flavor, scent, strength and formulation conflicts stop an exact match even when a barcode agrees. Missing facts remain Needs information. Known identity mismatches are excluded. A pack-only alternative is parked in Potential matches without a conversion, split, rebundle or additional search.

The previously agreed fallback remains: if all required reviewed identity fields agree strictly but package UPC verification is absent, the candidate may enter the normal exact-review tab with an explicit UPC unverified flag. It is not labeled a verified UPC match. No title-similarity score substitutes for exact field agreement.

The live Amazon/Keepa catalog connector is not connected in this version. Candidate ASINs and Amazon package facts are entered manually with source evidence and a reviewer label. Local extraction can suggest details from the supplied Amazon title; those remain unreviewed until accepted. This lets the exact-match logic and review workflow be tested before connecting live discovery.

UPC evidence comes from explicit API barcode fields, a printed package barcode, retailer/manufacturer specifications or a GS1 cross-check. Club SKUs and item numbers are never inferred to be UPCs. A GS1 Modulo 10 check validates the composition of a GTIN string, not ownership or correct package identity. Leading zeroes are preserved; equivalent UPC-A/EAN encodings compare through GTIN-14 padding, without stripping a nonzero packaging indicator. UPC-E expansion is not implemented; 8-digit inputs require an actual GTIN-8 identity.

Each UPC record identifies the full club package, an individual inner unit, or unknown scope. Only verified current-source full-package evidence participates in verified UPC matching. An inner bottle barcode does not establish a club 10-pack match. Manual changes retain revision history; stale source evidence requires rechecking. Candidate history is immutable and results are recalculated against current club details.

An optional manual **Check retailer details** button calls Scavio's documented Costco product endpoint for the exact saved retailer ID. The provider documents 1 credit if uncached. The response must identify exactly the requested item before UPC suggestions are collected. The complete lookup evidence and original date are retained separately; no source history is rewritten and no UPC is automatically verified. The provider does not guarantee that a UPC will be returned. No such live request was made during development.

An offline audit of the user's original 39-record handoff found no nonempty explicit UPC/GTIN/barcode fields. Additional evidence is therefore needed for those saved records. Photo analysis remains disconnected.

References: https://scavio.dev/docs/costco-product and https://www2.gs1.org/services/verified-by-gs1 and https://ref.gs1.org/standards/genspecs/19.0.0/

## Verification boundaries

Automated tests use synthetic provider fixtures and the real embedded PostgreSQL engine. They cover multi-page/247-item scans, no price ceiling, scoping, retries, stop/resume, concurrency, transactional rollback, immutable history, stale-cache behavior, diagnostics, redaction, formatted credit balances, local API access checks, exports, disk persistence and memory-only key storage. The synthetic Windows DPAPI round-trip test explicitly skips if the automated logon context cannot encrypt. This occurred on the build machine; encrypted storage still requires an interactive test under the user's normal Windows account.

Browser checks use the synthetic demo. No real Scavio search, paid API call, Keepa/Amazon connection, retailer login or hosted PostgreSQL server was used. The external PostgreSQL driver path needs an integration run against the selected server. Actual provider response shape/coverage and available credits still require a user-run live pilot.

Additional tests cover title extraction, ambiguous counts, API/title conflicts, manual draft/confirmation history, incomplete identities, invalid values, concurrent review conflicts, rescan persistence and changed-source rechecks. Browser checks exercise editing, saving, reopening, review status and history on desktop/mobile layouts. These use synthetic data; the extraction rules are not guaranteed to understand every SKU.

New matching tests cover GTIN checks, leading zeroes, explicit-field UPC extraction, exact package gates, UPC-unverified flags, parked alternatives, excluded mismatches, immutable evidence, current-source recalculation and retailer-detail response identity checks. No live Amazon/Keepa discovery or external barcode service was tested.

Photo analysis, the secondary matching engine, live catalog discovery, ROI, purchase approvals, buying/worker operations, scheduling and SMS remain later modules. Research, Enrichment and exact matching do not authorize purchases.

## Provider references checked for this implementation

- https://scavio.dev/docs/costco-category
- https://scavio.dev/docs/costco-categories
- https://scavio.dev/docs/costco-deals
- https://scavio.dev/docs/costco-coupons
- https://scavio.dev/docs/costco-warehouses
- https://scavio.dev/docs/usage
- https://pglite.dev/docs/
- https://node-postgres.com/features/transactions
