@echo off
setlocal

echo Checking whether Google Chrome is already running...
tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I "chrome.exe" >NUL
if not errorlevel 1 (
    echo Please close all Chrome windows and run this file again.
    pause
    exit /b 1
)

set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "USER_DATA_DIR=C:\Users\Nir\AppData\Local\Google\Chrome\User Data"
set "PROFILE_DIR=Default"
set "START_URL=https://www.amazon.com"

if not exist "%CHROME_EXE%" (
    echo Chrome was not found at:
    echo "%CHROME_EXE%"
    pause
    exit /b 1
)

echo Launching Chrome with remote debugging enabled on port 9222...
start "" "%CHROME_EXE%" --remote-debugging-port=9222 --user-data-dir="%USER_DATA_DIR%" --profile-directory="%PROFILE_DIR%" "%START_URL%"

if errorlevel 1 (
    echo Failed to launch Chrome.
    pause
    exit /b 1
)

echo Chrome launched successfully.
echo Remote debugging port: 9222
echo Opened: %START_URL%
pause
exit /b 0
