@echo off
setlocal
cd /d "%~dp0"
npm run doctor
exit /b %ERRORLEVEL%
