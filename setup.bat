@echo off
rem greenhub development setup for this Windows machine (see scripts\dev\setup-windows.ps1).
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev\setup-windows.ps1" %*
set "SETUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %SETUP_EXIT%
