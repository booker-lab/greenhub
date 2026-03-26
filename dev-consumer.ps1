$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source
if (-not $pnpm) {
    $pnpm = "$env:APPDATA\npm\pnpm.cmd"
}

Write-Host "기존 Node.js 프로세스 종료 중..." -ForegroundColor Yellow
Stop-Process -Name node -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Set-Location "C:\Develop\greenhub"
Write-Host "서버 시작: http://localhost:3000" -ForegroundColor Green

Start-Sleep -Seconds 3
Start-Process "http://localhost:3000"

& $pnpm --filter consumer dev
