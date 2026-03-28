$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpm) {
    $pnpm = "$env:APPDATA\npm\pnpm.cmd"
}

Write-Host "기존 Node.js 프로세스 종료 중..." -ForegroundColor Yellow
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# API 서버 (별도 창)
Write-Host "API 서버 시작 중 (localhost:3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location 'C:\Develop\greenhub'; Write-Host '[API] http://localhost:3000' -ForegroundColor Cyan; & '$pnpm' --filter api start:dev"

Start-Sleep -Seconds 4

# 소비자 앱 (별도 창)
Write-Host "소비자 앱 시작 중 (localhost:3001)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "Set-Location 'C:\Develop\greenhub'; Write-Host '[Consumer] http://localhost:3001' -ForegroundColor Green; & '$pnpm' --filter consumer dev -- --port 3001"

Start-Sleep -Seconds 6
Start-Process "http://localhost:3001"

Write-Host ""
Write-Host "  API      → http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Consumer → http://localhost:3001" -ForegroundColor Green
Write-Host ""
Write-Host "Seller 앱도 필요하면 dev-local-all.bat 을 실행하세요." -ForegroundColor Gray
