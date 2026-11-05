# Costco standalone extraction module (Jason)

Costco is a **separate retailer module**, not part of BJ's. It receives Scavio API responses or authorized JSON files, normalizes Costco-only fields, and produces a retailer handoff for the central product database. No Amazon matching, purchasing, or profitability analysis happens here.

## Current scope
- Costco clearance markdowns and warehouse-specific offers
- Costco product identifiers, descriptions, pricing, package details and availability where supplied
- Provenance and warehouse ID on each record
- Honest coverage flags: a successful request does **not** mean all Costco clearance has been discovered

The Scavio HTTP transport lives in `Jason/scavio/` and can be shared by the Costco and Sam's Club modules. This folder owns Costco-specific interpretation and validation.

## Offline test
`node --test Jason/store-extraction/costco/test/*.test.mjs`

No live Costco data or Scavio API call has been validated yet. No API key is stored in this repository.
