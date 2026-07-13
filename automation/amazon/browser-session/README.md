# Amazon Browser Session Manager

This module owns the persistent **Google Chrome** profile used by Amazon automation and RevSeller.

## Guarantees

- Attaches to a regular Google Chrome session through the Chrome DevTools Protocol (CDP).
- Uses a supported, dedicated Chrome user-data directory for Amazon automation instead of the user's normal `Default` profile.
- Reuses cookies plus existing Amazon and RevSeller login sessions from that dedicated profile.
- Verifies that RevSeller is available before Amazon analysis starts, using profile inspection and live Amazon-page verification.
- Stops with `RevSeller extension is not available in the configured Chrome profile.` when the attached profile does not contain or expose RevSeller.
- Does not perform automatic login and never stores passwords in code.
- Exposes one reusable launcher for Amazon Product Discovery, Amazon Matching, and RevSeller.

## Required setup

Recent Chrome versions may refuse remote debugging against a normal everyday Chrome profile. Do **not** point attach mode at `C:\Users\Nir\AppData\Local\Google\Chrome\User Data\Default`. Use the repository launcher, which creates and reuses this dedicated profile by default:

```text
C:\Users\Nir\AppData\Local\Google\Chrome\Amazon Automation User Data\Default
```

Run:

```powershell
.\start-chrome-debug.bat
```

The batch file starts:

```text
C:\Program Files\Google\Chrome\Application\chrome.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\Amazon Automation User Data"
```

Then complete the one-time setup in that Chrome window:

1. Install the RevSeller extension.
2. Sign in to RevSeller.
3. Sign in to Amazon.
4. Keep the automation Chrome window open.
5. Run `npm run amazon:attach-check`.

Future runs reuse the same dedicated profile. Do not delete it unless you want to repeat the one-time setup.

## Configuration

Defaults on Windows:

- `AMAZON_CHROME_PATH`: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- `AMAZON_CHROME_USER_DATA_DIR`: `C:\Users\Nir\AppData\Local\Google\Chrome\Amazon Automation User Data`
- `AMAZON_CHROME_PROFILE_DIRECTORY`: `Default`
- `AMAZON_CHROME_CDP_ENDPOINT`: `http://127.0.0.1:9222`

Optional overrides:

- `AMAZON_CHROME_PATH`: full path to regular Google Chrome.
- `AMAZON_CHROME_USER_DATA_DIR`: full path to the dedicated automation Chrome user-data directory.
- `AMAZON_CHROME_PROFILE_DIRECTORY`: Chrome profile directory name inside the automation user-data directory, usually `Default`.
- `AMAZON_CHROME_CDP_ENDPOINT`: endpoint for the running automation Chrome session.

PowerShell example:

```powershell
$env:AMAZON_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:AMAZON_CHROME_USER_DATA_DIR = "$env:LOCALAPPDATA\Google\Chrome\Amazon Automation User Data"
$env:AMAZON_CHROME_PROFILE_DIRECTORY = "Default"
.\start-chrome-debug.bat
npm run amazon:attach-check
npm run run:amazon-analysis
```

## Validation workflow

1. `start-chrome-debug.bat` launches Chrome.
2. `http://127.0.0.1:9222/json/version` returns Chrome DevTools metadata.
3. `npm run amazon:attach-check` prints `PASS` after confirming Chrome attach mode, RevSeller, and Amazon login.
4. `npm run run:amazon-analysis` reads RevSeller data from the live Amazon product page.

## Usage

```js
import { getAmazonBrowserPage, closeAmazonBrowserSession } from './automation/amazon/browser-session/index.mjs';

const page = await getAmazonBrowserPage();
await page.goto('https://www.amazon.com/');

await closeAmazonBrowserSession();
```

Future Amazon modules should import this module instead of calling `chromium.launch()` or `chromium.launchPersistentContext()` directly. Amazon matching logic, add-to-cart behavior, and purchase behavior are intentionally outside this session manager.
