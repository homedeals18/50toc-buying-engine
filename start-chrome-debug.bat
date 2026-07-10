@echo off
setlocal

set "CHROME_DEBUG_PORT=9222"
set "CHROME_CDP_ENDPOINT=http://127.0.0.1:%CHROME_DEBUG_PORT%/json/version"
set "CHROME_USER_DATA_DIR=%LOCALAPPDATA%\Google\Chrome\User Data"
set "CHROME_PROFILE_DIRECTORY=Default"

set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" (
  echo Google Chrome was not found in Program Files.
  echo Update CHROME_EXE in this script if Chrome is installed somewhere else.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%CHROME_CDP_ENDPOINT%' -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  echo Chrome remote debugging is already available at http://127.0.0.1:%CHROME_DEBUG_PORT%/.
  echo Keep this Chrome window open, then run: npm run run:amazon-analysis
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-Process chrome -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %ERRORLEVEL% EQU 0 (
  echo Chrome is already running, but remote debugging is not available at http://127.0.0.1:%CHROME_DEBUG_PORT%/.
  echo Close all Chrome windows and background Chrome processes first, then run start-chrome-debug.bat again.
  echo This launcher will only reopen your existing Default profile; it will not create or use a temporary profile.
  exit /b 1
)

if not exist "%CHROME_USER_DATA_DIR%\%CHROME_PROFILE_DIRECTORY%" (
  echo The existing Chrome Default profile was not found at:
  echo   %CHROME_USER_DATA_DIR%\%CHROME_PROFILE_DIRECTORY%
  echo Open Chrome normally once to create the Default profile, then run this launcher again.
  exit /b 1
)

echo Starting Google Chrome with remote debugging on port %CHROME_DEBUG_PORT% using the existing Default profile.
echo User data directory: %CHROME_USER_DATA_DIR%
start "Chrome Debug" "%CHROME_EXE%" --remote-debugging-port=%CHROME_DEBUG_PORT% --user-data-dir="%CHROME_USER_DATA_DIR%" --profile-directory="%CHROME_PROFILE_DIRECTORY%"

echo Chrome is starting. Log into Amazon and RevSeller if needed, then run:
echo   npm run run:amazon-analysis
exit /b 0
