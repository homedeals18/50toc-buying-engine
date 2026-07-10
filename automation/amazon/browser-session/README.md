# Amazon Browser Session Manager

This module owns the single persistent **Google Chrome** profile used by Amazon automation and RevSeller.

## Guarantees

- Attaches to an already-running regular Google Chrome session through the Chrome DevTools Protocol (CDP).
- Uses the existing configured Chrome `User Data` directory and profile directory only for profile/extension inspection; it does not launch Chrome or create a temporary, clean, or fresh browser profile.
- Reuses cookies plus existing Amazon and RevSeller login sessions from that Chrome profile.
- Verifies that the RevSeller extension is available in the configured Chrome profile before Amazon analysis starts.
- Stops with `RevSeller extension is not available in the configured Chrome profile.` when the configured profile does not contain an enabled RevSeller extension.
- Does not perform automatic login, never stores passwords in code, and never creates another Chrome window.
- Exposes one reusable launcher for Amazon Product Discovery, Amazon Matching, and RevSeller.

## Required configuration

Set these environment variables before running Amazon or RevSeller automation:

- `AMAZON_CHROME_PATH`: full path to regular Google Chrome.
- `AMAZON_CHROME_USER_DATA_DIR`: full path to Chrome's existing `User Data` directory.
- `AMAZON_CHROME_PROFILE_DIRECTORY`: Chrome profile directory name inside `User Data`, such as `Default` or `Profile 1`.

Optional:

- `AMAZON_CHROME_CDP_ENDPOINT`: optional endpoint for an already-running Chrome session, defaulting to `http://127.0.0.1:9222`.

## Windows setup

1. Start your normal Chrome session with `--remote-debugging-port=9222` so CDP attach is available.
2. In Chrome, open `chrome://version`.
3. Copy these values:
   - **Executable Path** -> `AMAZON_CHROME_PATH`
   - **Profile Path** -> split into:
     - parent `User Data` folder -> `AMAZON_CHROME_USER_DATA_DIR`
     - final profile folder name (`Default`, `Profile 1`, etc.) -> `AMAZON_CHROME_PROFILE_DIRECTORY`
4. Confirm that RevSeller is installed and logged in in that exact Chrome profile.
5. Keep that same Chrome session open. The manager connects to the existing debuggable session or fails clearly; it never launches Chrome, creates a temporary profile, or creates another Chrome window.

PowerShell example:

```powershell
$env:AMAZON_CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:AMAZON_CHROME_USER_DATA_DIR = "C:\Users\Nir\AppData\Local\Google\Chrome\User Data"
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

Future Amazon modules should import this module instead of calling `chromium.launch()` or `chromium.launchPersistentContext()` directly; attach mode is the only supported browser startup path. Amazon matching logic, add-to-cart behavior, and purchase behavior are intentionally outside this session manager.
