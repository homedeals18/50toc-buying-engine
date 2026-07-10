@echo off
setlocal

set "CHROME=%AMAZON_CHROME_PATH%"
if "%CHROME%"=="" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"

tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>NUL | find /I "chrome.exe" >NUL
if not errorlevel 1 (
    echo Please close all Chrome windows and run this file again.
    pause
    exit /b 1
)

start "Chrome Debug" "%CHROME%" ^
    --remote-debugging-port=9222 ^
    --user-data-dir="C:\Users\Nir\AppData\Local\Google\Chrome\User Data" ^
    --profile-directory="Default" ^
    https://www.amazon.com

set "DEBUG_URL=http://127.0.0.1:9222/json/version"
set "CHROME_READY="

for /L %%I in (1,1,20) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Uri '%DEBUG_URL%' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >NUL 2>NUL
    if not errorlevel 1 (
        set "CHROME_READY=1"
        goto chrome_check_done
    )
    timeout /T 1 /NOBREAK >NUL
)

:chrome_check_done
if defined CHROME_READY (
    echo Chrome Attach Mode is ready.
) else (
    echo Failed to open Chrome remote debugging on port 9222.
)

pause
