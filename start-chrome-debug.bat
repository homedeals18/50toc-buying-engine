@echo off
setlocal
set "CHROME=%AMAZON_CHROME_PATH%"
if "%CHROME%"=="" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
start "Chrome Debug" "%CHROME%" --remote-debugging-port=9222
