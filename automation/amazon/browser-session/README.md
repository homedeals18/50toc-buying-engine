# Amazon Browser Session Manager

This module owns the single persistent Chromium profile used by Amazon automation and RevSeller.

## Guarantees

- Uses one Playwright persistent Chromium context.
- Saves the browser profile under `artifacts/amazon/browser-session/chromium-profile` by default.
- Reuses cookies and existing Amazon/RevSeller login sessions across runs.
- Does not perform automatic login and never stores passwords in code.
- Exposes one reusable launcher for Amazon Product Discovery, Amazon Matching, and RevSeller.

## Usage

```js
import { getAmazonBrowserPage, closeAmazonBrowserSession } from './automation/amazon/browser-session/index.mjs';

const page = await getAmazonBrowserPage();
await page.goto('https://www.amazon.com/');

await closeAmazonBrowserSession();
```

Set `AMAZON_BROWSER_PROFILE_DIR` to override the local profile directory and `AMAZON_BROWSER_HEADLESS=true` to run headless. Future Amazon modules should import this module instead of calling `chromium.launch()` or `chromium.launchPersistentContext()` directly.
