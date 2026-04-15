@echo off
echo Starting Green Love Dev Servers...
echo.
echo   consumer  → http://localhost:3000
echo   seller    → http://localhost:3001
echo   driver    → http://localhost:3003
echo.

start "GreenLove Consumer :3000" cmd /k "cd /d %~dp0apps\consumer && pnpm dev"
timeout /t 2 /nobreak >nul
start "GreenLove Seller   :3001" cmd /k "cd /d %~dp0apps\seller && pnpm dev --port 3001"
timeout /t 2 /nobreak >nul
start "GreenLove Driver   :3003" cmd /k "cd /d %~dp0apps\driver && pnpm dev"

echo All servers started. Close each terminal window to stop.
