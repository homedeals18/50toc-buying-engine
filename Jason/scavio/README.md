# Jason's Scavio API connector

Separate from Nir's existing code. No credentials are committed. Uses documented Scavio HTTPS POST endpoints with JSON responses.

## Costco-first workflow
1. Create a GitHub Actions **environment** named `jason-scavio-test` under repository Settings > Environments.
2. Add an **environment secret** `SCAVIO_API_KEY` containing your Scavio test key. Do not paste it in chat or commit it.
3. Find a Costco warehouse ID using the Scavio warehouse endpoint or playground.
4. Open Actions > **Jason Scavio API test** > Run workflow; select the `jason/bjs-extraction-foundation` branch, `costcoClearance`, a warehouse ID and a short query.
5. Download the `jason-scavio-response` artifact and inspect actual fields before building the normalization handoff.

This workflow makes **one** API request per run (Costco clearance costs 2 credits in the US). It does not log into any retailer, schedule scans, purchase products, or run Amazon matching.

## Local use
```sh
node --test Jason/scavio/test/*.test.mjs
SCAVIO_API_KEY=... SCAVIO_KIND=costcoClearance SCAVIO_BODY='{"warehouse_id":"1062","query":"snacks","pages":1}' node Jason/scavio/src/run.mjs
```

Store keys in secret storage, not shell history. The local command is illustrative. Never use the already exposed chat key in production.

Docs: https://scavio.dev/docs/costco-clearance and https://scavio.dev/samsclub-api

**Limitations:** No live request has been executed from this repository yet. Scavio's JSON schema and data quality must be verified from real results. Costco clearance only covers products listed online, and a search/query is not a complete catalog sweep. No automatic spend or scheduled polling.
