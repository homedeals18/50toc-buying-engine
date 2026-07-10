@echo off
setlocal

set "DEBUG_ENDPOINT=http://127.0.0.1:9222/json/version"
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "USER_DATA_DIR=C:\Users\Nir\AppData\Local\Google\Chrome\User Data"
set "PROFILE_DIR=Default"
set "START_URL=https://www.amazon.com"

tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
if not errorlevel 1 (
    echo Please close all Chrome windows and run this file again.
    exit /b 1
)

if not exist "%CHROME_EXE%" (
    echo Error: Google Chrome was not found at "%CHROME_EXE%".
    echo Install regular Google Chrome or update CHROME_EXE in this file.
    pause
    exit /b 1
)

echo Launching Google Chrome for Chrome Attach Mode...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%USER_DATA_DIR%" --profile-directory="%PROFILE_DIR%" "%START_URL%"

echo Waiting for Chrome Attach Mode on %DEBUG_ENDPOINT%...
for /L %%I in (1,1,20) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%DEBUG_ENDPOINT%' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >NUL 2>NUL
    if not errorlevel 1 (
        echo Chrome Attach Mode is ready.
        exit /b 0
    )
    timeout /t 1 /nobreak >NUL
)

echo Error: Chrome launched, but %DEBUG_ENDPOINT% was not available within 20 seconds.
echo Confirm Chrome is not blocked by policy/security software and that port 9222 is free.
pause
exit /b 1
