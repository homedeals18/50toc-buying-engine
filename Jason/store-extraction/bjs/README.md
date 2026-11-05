# BJ's extraction — Jason

This module accepts BJ's product data from authorized inputs and produces a standardized retailer handoff. It does not do Amazon matching, profitability or purchasing.

## JSON-LD adapter

`src/json-ld.mjs` reproduces the useful **data-parsing technique** in Nir's `automation/bjs/tests/deal-discovery.spec.js`: it parses supplied `application/ld+json` product data and extracts name, SKU, GTIN, brand, offer price, availability and image. It also handles `@graph` JSON-LD structures and optionally matches a requested SKU.

**Important:** This adapter is offline. It does not access BJ's, scrape pages, automate logins, or claim that JSON-LD is exempt from BJ's website terms. Supply only data you have permission to collect and use.

## Run tests

```sh
node --test Jason/store-extraction/bjs/test/*.test.mjs
```

## Standardized handoff

`src/normalize.mjs` validates and deduplicates supplied product records. `src/cli.mjs` reads a JSON input file and writes a JSON handoff atomically.

```sh
node Jason/store-extraction/bjs/src/cli.mjs --input Jason/store-extraction/bjs/fixtures/sample-input.json --output /tmp/jason-bjs-handoff.json
```

No live BJ's scan has been run or validated yet.
