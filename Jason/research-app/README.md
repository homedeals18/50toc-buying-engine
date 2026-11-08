# 50TOC — Jason Core Buying Workflow 0.5

A local web application with React, Node 24 and PostgreSQL. The Windows package includes Node and embedded PostgreSQL (PGlite); no Python, Node or database installation is needed. All changes live under Jason. The inherited application directories and main branch remain untouched.

## Start and upgrade

Extract the whole Windows ZIP. Close any older 50TOC command window, then run START_RESEARCH.cmd for LIVE mode or START_DEMO.cmd for synthetic examples without API credits. Open http://127.0.0.1:8876 in Chrome, Edge or the ChatGPT browser on this computer. The footer must show Core workflow 0.5. Real key fields are deliberately disabled in DEMO. Leave the service open; computer sleep pauses local work.

The ZIP includes no user data or real keys. Read UPGRADE_FROM_0_1.txt and back up the entire old data folder before using existing Jason 0.1, 0.2 or 0.3 records. Never run two versions against the same database. Migrations are additive. The older Research Web 1.x SQLite prototype is a separate application and is not silently migrated.

TEST_GUIDE.txt provides the test sequence and limitations. Source development uses `npm install`, `npm run build`, `npm test` and `npm start` with Node 24+. The prepared Windows ZIP already includes production dependencies and built assets.

## Research and Enrichment

Costco is the first active research connector. Select actual warehouses, departments and deal types. Markdown endings share one department task. All supported returned result pages and products are processed with no arbitrary product cap and no purchase-price ceiling. Warehouse observations remain distinct from online prices, source pages retain evidence, and server-owned jobs can stop/resume. Failed coverage is visible. Provider coverage does not mean every item physically in a warehouse.

Enrichment extracts local title/structured-field suggestions for product, pack, contents, size/basis, flavor, scent, formulation and strength. Human fields and history survive rescans. Packaging changes require rechecking; price-only changes do not erase identity work. Research saves photo links; automated photo interpretation remains disconnected.

## Automatic UPC lookup

Estimate one saved product or every eligible saved product, then explicitly start. No paid UPC job starts on ingestion, launch or restart. Saved explicit barcode fields are checked first. Missing identifiers use Costco product-detail batches of up to 20 items. Exact typed retailer IDs must agree; missing or ambiguous identities are not assigned by response order.

For still-missing identifiers, use one Scavio Google Custom Search results page, retaining all returned valid public links and labelled barcode snippets, then read up to two ranked source pages through normal-mode Extract. This web-search depth is separate from Research pagination. Additional search links stay visible for manual follow-up. No automatic higher scraping tier, login, image reading or paid retry is used. The estimate is at most ceil(missing/20) + 3*missing Scavio credits if uncached; saved barcode fields, missing links and cache hits reduce requests. Both search and normal Extract are documented as 1 credit/request. Original cache observation times are retained.

The queue processes all eligible products and persists checkpoints and dated evidence. Stop finishes the in-flight request; Resume is explicit. Restart marks unfinished work interrupted without spending credits. Current verified full-package UPCs are skipped. Successfully checked unchanged products are skipped for 24 hours unless recheck is chosen. Failed/incomplete evidence remains flagged.

Identifiers are found only in explicit API fields or labelled UPC/GTIN/EAN/barcode text; no barcode is invented from a title, SKU or item number. Keep leading zeroes and validate GS1 Modulo 10 for 8/12/13/14-digit strings. An 8-digit value must be GTIN-8; UPC-E expansion is not implemented. A checksum validates composition, not ownership or package identity. Numbers from another retailer, snippets, conflicting codes and differing product/package facts require human confirmation. Page text may include related variants, so all automatic findings remain unverified with unknown package scope. Lookup never overwrites a human UPC record.

## Amazon exact matching

Save Keepa separately in Settings. A confirmed current full club-package UPC can query Keepa's US product-code endpoint with statistics and Buy Box data. Multiple returned ASINs are retained. Imported titles/fields/barcodes remain unreviewed, and existing human-reviewed ASIN records are preserved. A manual catalog-evidence entry path also exists. Keepa requests use a fixed HTTPS host, server-side credentials, dated 24-hour caching, bounded responses, redacted diagnostics and no automatic paid retries. Saving a key does not make a request. UPC searches can return multiple ASINs and consume tokens per the provider; no fixed total-token guarantee is implied.

The new exact engine does not import the inherited matcher. It requires reviewed identity and package evidence; brand, flavor, size, formulation and container/contents conflicts cannot be bypassed by a shared UPC. Current verified package UPC plus reviewed agreement yields the barcode exact route. A strict reviewed-details match without a verified UPC may enter normal exact review with the explicit UPC-unverified warning, per the agreed workflow. Inner-unit barcodes do not verify the outer club package. Potential matches, missing information and excluded mismatches remain separate. A secondary broader discovery/alternate-pack engine and selling-unit conversions are deferred.

## Analysis and human approval

Use the current Buy Box, confirmed total Amazon fee estimate, explicit club tax/cost inputs, rank/category and sourced monthly velocity. Keepa prices retain the provider's actual Buy Box update time; fetching old data does not make its price current. Missing/negative price sentinels stay unknown. Keepa fulfillment/referral components are not assumed to be the complete fee total, monthlySold is an Amazon bought-past-month lower-bound bracket rather than a sales estimate, and rank drops are not unit sales. Account eligibility is eligible, restricted or not checked; no missing check becomes eligible. Direct Amazon/RevSeller fee and restriction checks remain disconnected. Manual evidence supports the core test workflow.

Complete cost per exact Amazon selling unit = club price + tax per club package + worker allowance per club package + standard prep/packing/inbound shipping + explicitly entered other costs. One exact club package currently corresponds to one Amazon selling unit. Net proceeds = current selling price - total Amazon fees. Profit = proceeds - complete cost; ROI = profit / complete cost. No cashback or rewards. Missing fees/costs stay unknown. Defaults are $0.75 worker allowance per club package and $0.75 standard prep/shipping per Amazon unit; additional rebundling $0.75 is retained in settings for the deferred alternate-pack module and is not silently charged to exact packages.

Profit Controls require both ROI and dollar profit plus rank and velocity cutoffs and their Close ranges. Thresholds/tolerances are initially unset. Category rank/velocity overrides are supported. Negative known profit automatically rejects the opportunity; unresolved critical facts block approval. Close requires an explicit full-access exception reason. Every buying target requires human approval, with quantity in total club units, maximum club price, warehouses, user/time and preserved analysis/settings evidence. Unknown eligibility needs acknowledgment. Budget warnings use outstanding commitment plus applicable actual spending and require a recorded full-access override.

Reject an opportunity once, permanently block a mapping, or block the club product. Blocks and removal history survive rescans. Reanalysis retains history and holds outstanding buying for renewed approval; it does not erase bought units. UPC, profile, mapping and control changes are rechecked before recording another purchase. There is no automatic buying or club checkout.

## Buying, receipts, pay and scheduling

A target is shared across permitted warehouses and workers: 500 approved minus 100 bought leaves 400. Workers reserve the units they plan to buy, preventing simultaneous allocation of the same remainder. Reservations do not silently expire while a worker shops; the worker can release their units. Purchases are transactional and idempotent, use actual unit price/tax/warehouse, accept lower prices within authorization and reject prices above the maximum. A higher-price submission holds buying for urgent review. Manual purchases immediately affect remaining and unpaid club units, without waiting for a receipt.

Workers submit new shelf finds, higher prices, not-found reports and corrections; photos/PDFs can be attached as evidence. Full-access intake explicitly confirms shelf identity/price before adding that observation to Research. It never skips identity, economics or purchase approval. In-store submissions remain visibly unqualified until reviewed. SMS/email are disconnected.

Receipts attach to existing purchases and can cover multiple items. Content is validated as PDF/JPEG/PNG/WebP, up to 8 MB, stored with a checksum and access controls, and duplicate uploads do not add quantities. Manual receipt-line reconciliation compares quantity and discounted line total before separately recorded tax. OCR is disconnected. Manager corrections preserve audit history and update purchased/remaining quantities; changes to paid units create adjustment flags rather than rewriting completed payments.

Worker pay is based on club packages, not inner bottles or Amazon units. Choose worker and inclusive New York calendar dates, enter item-group rates, Calculate, then Mark paid. Payments retain included purchase revisions, quantities, rates and totals; paid units are excluded from later unpaid quotes. Concurrent/retried requests cannot pay the same units twice. Mark paid records an external payment; the application does not transmit funds. Paid-work adjustments require manual review.

Warehouse visits can be planned without creating new targets. Outstanding quantities carry forward. A local checker runs at most once daily per outstanding target while the service is open, comparing SAVED observations, approval evidence and current controls. It is not a fresh retailer/Keepa API refresh. Stale or failed required evidence holds further buying conservatively until Research/Analysis are refreshed and reapproved. Price drops and known sale dates are displayed for review, including completed targets, without authorizing more units. Hosted scheduling, route optimization, automatic inventory reconciliation and four-to-six-week seller-share quantity guidance remain deferred.

CSV exports for Excel cover source fields, analyses/decisions, targets, purchases, payments, submissions and deal alerts. Original matching/UPC reports and histories can also be exported. Formula-like spreadsheet cells are escaped.

## Access and storage boundaries

The local service binds 127.0.0.1 only. Before account setup it runs as Local manager, relying on access to this computer. Creating the first full-access account enables sign-in for all operational APIs. Additional authorized users have equal full access; workers get a separate mobile screen and server-enforced restrictions. Passwords use per-user salts and scrypt; login sessions use random hashed tokens, HttpOnly/SameSite cookies and 12-hour expiration with login throttling. Workers cannot access Research, credentials, profit settings, approvals, payments or managerial analysis snapshots. Local session/origin/host checks remain in place.

Scavio and Keepa keys remain server-side in memory, environment variables or Windows-encrypted storage. They are never returned to the UI, bundled or committed. Session-only keys disappear when the service closes. Windows encryption is tied to the Windows account. Environment settings SCAVIO_API_KEY and KEEPA_API_KEY take precedence. PGlite is the default; DATABASE_URL selects the existing PostgreSQL-server path. Shared TLS hosting, deployment, remote access, production backups/account recovery and server operations must be established before using the app from other devices. GitHub stores code, not a shared running database.

## Verification and remaining integrations

Tests use synthetic provider fixtures and real embedded PostgreSQL. They cover Research completeness/recovery, extraction/history, exact matching and UPC discovery, financial gates, approval snapshots, reservations, idempotent purchasing, receipt deduplication/reconciliation, paid-work adjustments, concurrent pay prevention and role enforcement. Browser checks exercise the manager calculation/approval/purchase/pay sequence and the separate worker phone screen. Portable runtime checks validate the extracted ZIP and restart persistence.

No live Scavio, Keepa, Amazon SP-API, RevSeller or paid image request was made during this build. Live coverage, provider account permissions, actual response shapes, fee completeness, tokens and timestamps require the user's pilot. External PostgreSQL hosting is untested. The Windows DPAPI round-trip test may explicitly skip in the automated Windows logon; interactive encrypted-key verification remains necessary. Successful fixture tests do not prove live matching accuracy or seller eligibility.

References checked: https://scavio.dev/docs/costco-product ; https://scavio.dev/docs/google-custom-search-api ; https://scavio.dev/docs/extract ; https://keepa.com/api-docs/product.html ; https://keepa.com/api-docs/product-object.html ; https://keepa.com/api-docs/statistics-object.html ; https://keepa.com/api-docs/request-basics.html ; https://www2.gs1.org/services/verified-by-gs1
