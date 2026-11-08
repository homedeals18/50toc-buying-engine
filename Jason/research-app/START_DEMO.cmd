@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo This is the source folder. Use the prepared Windows ZIP or run npm install and npm run build with Node 24 or newer.
  pause
  exit /b 1
)
echo Starting the demo. No real API calls or credits.
echo Open the local address printed below. Keep this window open.
"runtime\node.exe" server\main.mjs --demo --open-browser
pause
