@echo off
setlocal
cd /d "%~dp0"
node scripts\dev\local\launcher.mjs %*
exit /b %ERRORLEVEL%
