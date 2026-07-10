# Amazon Browser Session Manager

This module owns the single persistent **Google Chrome** profile used by Amazon automation and RevSeller.

## Guarantees

- Uses regular Google Chrome through Playwright's persistent-context launcher.
- Uses the existing configured Chrome `User Data` directory and profile directory; it does not create a temporary, clean, or fresh browser profile.
- Reuses cookies plus existing Amazon and RevSeller login sessions from that Chrome profile.
- Verifies that the RevSeller extension is available in the configured Chrome profile before Amazon analysis starts.
- Stops with `RevSeller extension is not available in the configured Chrome profile.` when the configured profile does not contain an enabled RevSeller extension.
- Does not perform automatic login and never stores passwords in code.
- Exposes one reusable launcher for Amazon Product Discovery, Amazon Matching, and RevSeller.

## Required configuration

Set these environment variables before running Amazon or RevSeller automation:

- `AMAZON_CHROME_PATH`: full path to regular Google Chrome.
- `AMAZON_CHROME_USER_DATA_DIR`: full path to Chrome's existing `User Data` directory.
- `AMAZON_CHROME_PROFILE_DIRECTORY`: Chrome profile directory name inside `User Data`, such as `Default` or `Profile 1`.

Optional:

- `AMAZON_BROWSER_HEADLESS=true`: run headless. For extension-backed RevSeller analysis, headed Chrome is recommended because Chrome extensions may not behave consistently in headless mode.

## Windows setup

1. Close all Chrome windows that are using the target profile, or make sure no separate Chrome process is locking the profile.
2. In Chrome, open `chrome://version`.
3. Copy these values:
   - **Executable Path** -> `AMAZON_CHROME_PATH`
   - **Profile Path** -> split into:
     - parent `User Data` folder -> `AMAZON_CHROME_USER_DATA_DIR`
     - final profile folder name (`Default`, `Profile 1`, etc.) -> `AMAZON_CHROME_PROFILE_DIRECTORY`
4. Confirm that RevSeller is installed and logged in in that exact Chrome profile.

PowerShell example:

```powershell
$env:AMAZON_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:AMAZON_CHROME_USER_DATA_DIR = "$env:LOCALAPPDATA\Google\Chrome\User Data"
$env:AMAZON_CHROME_PROFILE_DIRECTORY = "Default"
npm run read:revseller
```

If `chrome://version` shows `C:\Users\you\AppData\Local\Google\Chrome\User Data\Profile 1` as the profile path, use:

```powershell
$env:AMAZON_CHROME_USER_DATA_DIR = "C:\Users\you\AppData\Local\Google\Chrome\User Data"
$env:AMAZON_CHROME_PROFILE_DIRECTORY = "Profile 1"
```

## Usage

```js
import { getAmazonBrowserPage, closeAmazonBrowserSession } from './automation/amazon/browser-session/index.mjs';

const page = await getAmazonBrowserPage();
await page.goto('https://www.amazon.com/');

await closeAmazonBrowserSession();
```

Future Amazon modules should import this module instead of calling `chromium.launch()` or `chromium.launchPersistentContext()` directly. Amazon matching logic, add-to-cart behavior, and purchase behavior are intentionally outside this session manager.
