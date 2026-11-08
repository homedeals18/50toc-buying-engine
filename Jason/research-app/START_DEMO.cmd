@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo This is the source folder. Use the prepared Windows ZIP or run npm install and npm run build with Node 24 or newer.
  pause
  exit /b 1
)
echo Starting 50TOC Jason Buying Engine 0.5 - DEMO mode. No real API calls or credits.
echo API key fields are disabled in DEMO. Use START_RESEARCH.cmd for real searches.
echo Open the local address printed below. Keep this window open.
"runtime\node.exe" server\main.mjs --demo --open-browser
pause
