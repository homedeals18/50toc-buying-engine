@echo off
setlocal EnableExtensions

set "CHROME=%AMAZON_CHROME_PATH%"
if "%CHROME%"=="" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"

set "AUTOMATION_USER_DATA_DIR=%AMAZON_CHROME_USER_DATA_DIR%"
if "%AUTOMATION_USER_DATA_DIR%"=="" set "AUTOMATION_USER_DATA_DIR=%LOCALAPPDATA%\Google\Chrome\Amazon Automation User Data"

set "DEBUG_PORT=%AMAZON_CHROME_DEBUG_PORT%"
if "%DEBUG_PORT%"=="" set "DEBUG_PORT=9222"
set "DEBUG_URL=http://127.0.0.1:%DEBUG_PORT%/json/version"

if not exist "%CHROME%" (
    echo Chrome was not found at "%CHROME%".
    echo Set AMAZON_CHROME_PATH to your chrome.exe path and run this file again.
    pause
    exit /b 1
)

if not exist "%AUTOMATION_USER_DATA_DIR%" mkdir "%AUTOMATION_USER_DATA_DIR%" >NUL 2>NUL

echo Starting Chrome Attach Mode with a dedicated automation profile...
echo Chrome: "%CHROME%"
echo Profile: "%AUTOMATION_USER_DATA_DIR%"
echo DevTools: %DEBUG_URL%

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%DEBUG_URL%' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >NUL 2>NUL
if not errorlevel 1 (
    echo Chrome Attach Mode is already ready on port %DEBUG_PORT%.
    goto chrome_ready
)

start "Chrome Amazon Automation" "%CHROME%" ^
    --remote-debugging-address=127.0.0.1 ^
    --remote-debugging-port=%DEBUG_PORT% ^
    --user-data-dir="%AUTOMATION_USER_DATA_DIR%" ^
    --no-first-run ^
    --no-default-browser-check ^
    https://www.amazon.com

set "CHROME_READY="
for /L %%I in (1,1,30) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%DEBUG_URL%' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >NUL 2>NUL
    if not errorlevel 1 (
        set "CHROME_READY=1"
        goto chrome_check_done
    )
    timeout /T 1 /NOBREAK >NUL
)

:chrome_check_done
if defined CHROME_READY (
    goto chrome_ready
) else (
    echo Failed to open Chrome remote debugging on port %DEBUG_PORT%.
    echo If another Chrome automation window is open, close that window and run this file again.
    pause
    exit /b 1
)

:chrome_ready
echo Chrome Attach Mode is ready.
echo.
echo One-time setup for this dedicated profile:
echo  1. Install the RevSeller extension in this Chrome window.
echo  2. Sign in to RevSeller.
echo  3. Sign in to Amazon.
echo  4. Keep this Chrome window open, then run: npm run amazon:attach-check
echo.
echo Future runs reuse this same profile: "%AUTOMATION_USER_DATA_DIR%"
pause
