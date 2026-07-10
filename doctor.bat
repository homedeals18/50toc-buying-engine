@echo off
setlocal EnableExtensions
cd /d "%~dp0"
node automation\setup\doctor.mjs
exit /b %ERRORLEVEL%
