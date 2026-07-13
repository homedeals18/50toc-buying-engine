# 50TOC Profit Analyzer v1 SP-API setup

The Profit Analyzer replaces the RevSeller/Chrome-extension workflow with Amazon Selling Partner API (SP-API) estimates. It never commits credentials, creates listings, adds to cart, or purchases products.

## Required local environment variables

Store these only in your local shell, `.env` manager, or CI secret store:

- `SP_API_CLIENT_ID`
- `SP_API_CLIENT_SECRET`
- `SP_API_REFRESH_TOKEN`
- `SP_API_AWS_ACCESS_KEY_ID`
- `SP_API_AWS_SECRET_ACCESS_KEY`
- `SP_API_AWS_SESSION_TOKEN` (only when temporary AWS credentials are used)
- `SP_API_SELLER_ID` (required by Listings Restrictions)

## Authorization workflow

1. Create or use an Amazon Seller Central developer application with access to Catalog Items, Product Pricing, Product Fees, and Listings Restrictions.
2. Authorize the seller account to that application and capture the Login With Amazon refresh token.
3. Create an IAM user or role permitted to execute SP-API requests for the app registration.
4. Export the variables above in the terminal before running the analyzer.
5. Run the analyzer with an ASIN and costs:

```bash
npm run analyze:profit -- --asin B0FX3DY3C7 --marketplace US --purchase-cost 43.19 --fulfillment-method FBA --inbound-shipping 0 --minimum-target-roi 30
```

If authorization is incomplete, `artifacts/profit-analyzer/profit-analysis.json` will return `auth.status: "missing_authorization"` and list the exact missing environment variables.

## Outputs

- `artifacts/profit-analyzer/profit-analysis.json`
- `artifacts/profit-analyzer/execution-report.json`

All fee, profit, ROI, and max-cost values are labeled estimates because Amazon can change prices, fees, restrictions, and offers after the request.
