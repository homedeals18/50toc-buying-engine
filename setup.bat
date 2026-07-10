@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo 50TOC Buying Engine - One-Click Setup
echo =====================================

where node >NUL 2>NUL
if errorlevel 1 (
  echo FAIL Node.js was not found.
  echo Fix: Install Node.js 18 or newer from https://nodejs.org/ and run setup.bat again.
  exit /b 1
)

where npm >NUL 2>NUL
if errorlevel 1 (
  echo FAIL npm was not found.
  echo Fix: Reinstall Node.js from https://nodejs.org/ and reopen this terminal.
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >NUL
    echo PASS Created .env from .env.example.
    echo IMPORTANT: Edit .env so AMAZON_CHROME_USER_DATA_DIR and AMAZON_CHROME_PROFILE_DIRECTORY match your Chrome profile from chrome://version.
  ) else (
    echo FAIL .env.example was not found.
    echo Fix: Restore .env.example from the repository and rerun setup.bat.
    exit /b 1
  )
) else (
  echo PASS .env already exists.
)

for %%D in ("automation\bjs" "automation\costco_business_center" "automation\sams_club" "automation\revseller") do (
  echo Installing npm dependencies in %%~D...
  pushd "%%~D"
  call npm install
  if errorlevel 1 exit /b 1
  call npx playwright install chromium
  if errorlevel 1 exit /b 1
  popd
)

for %%D in ("artifacts\bjs\logs" "artifacts\bjs\screenshots" "artifacts\costco_business_center\logs" "artifacts\costco_business_center\screenshots" "artifacts\sams_club\logs" "artifacts\sams_club\screenshots" "artifacts\main" "artifacts\amazon" "artifacts\revseller\logs" "artifacts\decision-engine" "artifacts\orchestrator") do (
  if not exist "%%~D" mkdir "%%~D"
)

echo.
echo Setup complete. Next steps:
echo 1. Edit .env with your Chrome path/profile values from chrome://version.
echo 2. Run start-chrome-debug.bat and sign in to Amazon and RevSeller in that Chrome window.
echo 3. Run doctor.bat or npm run doctor.
exit /b 0
