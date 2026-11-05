# 50TOC Buying Engine — Jason

Independent development area for Jason's store-extraction-first version. Nir's original directories remain unchanged.

## Architecture

- `store-extraction/bjs`: BJ's retailer-specific extraction, normalization and validation.
- `central-product-database`: future common ingestion and storage for every retailer.
- `profit-center`: future centralized Amazon matching, eligibility, fees and ROI.
- `dashboard`: future employee interface.

**Boundary:** Retailer extractors do not call Amazon, calculate profit, decide BUY/REJECT, or purchase items.

## First milestone: BJ's

The initial implementation is a standalone, dependency-free Node.js extraction foundation. It consumes BJ's raw records, validates and normalizes them into a common retailer handoff, deduplicates by retailer/store/SKU or URL, and writes an atomic JSON output plus scan report.

Run from the repository root:

```sh
node --test Jason/store-extraction/bjs/test/*.test.mjs
node Jason/store-extraction/bjs/src/cli.mjs --input Jason/store-extraction/bjs/fixtures/sample-input.json --output /tmp/jason-bjs-output.json
```

The sample is synthetic. **A live authenticated BJ's browser extraction is not yet connected or verified.** The next step is to adapt Nir's Playwright collector to produce raw records for this pipeline, then test pagination/completeness, location prices, UPC capture, and recovery with actual authorized scans.

Never put credentials or browser profiles in Git. No cart or checkout automation.
