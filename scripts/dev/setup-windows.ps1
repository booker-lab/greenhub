# greenhub 개발 환경을 이 Windows 컴퓨터에 한 번에 맞춘다. 여러 번 실행해도 결과는 같다.
#  1. fnm(Node 버전 관리자)이 없으면 winget으로 설치한다.
#  2. PowerShell·Git Bash 프로필에 fnm 자동 전환을 넣는다(이미 fnm 설정이 있으면 건너뛴다).
#     프로필이 실행되도록 현재 사용자 실행 정책이 Restricted·AllSigned면 RemoteSigned로 바꾼다.
#  3. .nvmrc의 Node를 설치해 쓰고 corepack(pnpm)을 켠다.
#  4. pnpm install --frozen-lockfile, Playwright chromium 설치, pnpm dev:check를 실행한다.
# 실행: 저장소 루트의 setup.bat을 더블클릭하거나 PowerShell에서 .\scripts\dev\setup-windows.ps1
# Windows PowerShell 5.1에서 돌아야 하므로 PowerShell 7 전용 문법(??, &&, 삼항 연산자)을 쓰지 않는다.
[CmdletBinding()]
param(
  # Playwright 브라우저 내려받기를 건너뛴다(E2E를 돌리지 않는 컴퓨터).
  [switch]$SkipBrowsers
)

$ErrorActionPreference = 'Stop'
$onWindows = [Environment]::OSVersion.Platform -eq 'Win32NT'
$repoRoot = (Resolve-Path (Join-Path (Join-Path $PSScriptRoot '..') '..')).Path
$profileMarker = '# greenhub: fnm auto switch (.nvmrc)'

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "== $Message" -ForegroundColor Cyan
}

function Invoke-Native([string]$Command, [string[]]$Arguments) {
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command $($Arguments -join ' ') 실패 (종료 코드 $LASTEXITCODE)"
  }
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Update-PathFromRegistry {
  # winget이 바꾼 PATH는 이미 열린 창에 반영되지 않아 레지스트리 값을 다시 읽는다.
  $parts = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User'),
    $env:Path
  ) | Where-Object { $_ }
  $env:Path = $parts -join [IO.Path]::PathSeparator
}

function Install-Fnm {
  if (Test-Command 'fnm') {
    Write-Host "fnm 설치돼 있음: $(& fnm --version)"
    return
  }
  if (-not (Test-Command 'winget')) {
    throw 'winget을 찾지 못했다. Microsoft Store에서 "앱 설치 관리자"를 설치하거나 https://github.com/Schniz/fnm 안내대로 fnm을 설치한 뒤 다시 실행한다.'
  }
  & winget install --id Schniz.fnm --exact --source winget --accept-source-agreements --accept-package-agreements
  $wingetExit = $LASTEXITCODE
  Update-PathFromRegistry
  if (-not (Test-Command 'fnm')) {
    throw "fnm을 설치하지 못했다(winget 종료 코드 $wingetExit). 새 터미널을 열고 다시 실행한다."
  }
  Write-Host "fnm 설치함: $(& fnm --version)"
}

function Set-ProfileExecutionPolicy {
  if (-not $onWindows) { return }
  # Process 범위(setup.bat의 Bypass)는 빼고, 새 창에서 적용될 정책을 우선순위대로 찾는다.
  $effective = 'Undefined'
  foreach ($scope in @('MachinePolicy', 'UserPolicy', 'CurrentUser', 'LocalMachine')) {
    $policy = [string](Get-ExecutionPolicy -Scope $scope)
    if ($policy -ne 'Undefined') {
      $effective = $policy
      if ($scope -like '*Policy') {
        Write-Warning "실행 정책이 그룹 정책($scope=$policy)으로 정해져 있어 바꾸지 않는다. 프로필이 실행되지 않으면 관리자에게 문의한다."
        return
      }
      break
    }
  }
  if (@('Undefined', 'Restricted', 'AllSigned') -contains $effective) {
    try {
      Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
    } catch {
      # setup.bat이 이 창에만 Bypass를 걸어 "더 구체적인 범위가 덮어쓴다"는 오류가 나도 CurrentUser 값은 바뀐다.
      if ([string](Get-ExecutionPolicy -Scope CurrentUser) -ne 'RemoteSigned') { throw }
    }
    Write-Host "PowerShell 프로필이 실행되도록 현재 사용자 실행 정책을 $effective 에서 RemoteSigned로 바꿨다."
  }
}

function Add-ProfileLine([string]$Path, [string]$Line) {
  $existing = ''
  if (Test-Path -LiteralPath $Path) {
    $existing = [IO.File]::ReadAllText($Path)
  } else {
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) {
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
  }
  if ($existing -match 'fnm env') {
    Write-Host "이미 fnm 설정이 있어 건너뜀: $Path"
    return
  }
  $prefix = ''
  if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { $prefix = "`n" }
  # BOM 없이 쓴다(Git Bash는 .bashrc 첫 줄의 BOM을 명령으로 읽는다).
  $text = $prefix + $profileMarker + "`n" + $Line + "`n"
  [IO.File]::AppendAllText($Path, $text, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "추가함: $Path"
}

function Add-ShellProfiles {
  # 문서 폴더가 아직 없어도 경로를 받아 프로필 폴더를 만든다.
  $documents = [Environment]::GetFolderPath('MyDocuments', [Environment+SpecialFolderOption]::DoNotVerify)
  if (-not $documents) { $documents = Join-Path $HOME 'Documents' }
  $powerShellLine = 'if (Get-Command fnm -ErrorAction SilentlyContinue) { fnm env --use-on-cd --corepack-enabled --shell powershell | Out-String | Invoke-Expression }'
  # Windows PowerShell 5.1과 PowerShell 7은 프로필 위치가 다르다.
  foreach ($folder in @('WindowsPowerShell', 'PowerShell')) {
    Add-ProfileLine (Join-Path (Join-Path $documents $folder) 'Microsoft.PowerShell_profile.ps1') $powerShellLine
  }
  if (Test-Command 'git') {
    $bashLine = 'if command -v fnm >/dev/null 2>&1; then eval "$(fnm env --use-on-cd --corepack-enabled --shell bash)"; fi'
    Add-ProfileLine (Join-Path $HOME '.bashrc') $bashLine
  }
}

function Use-PinnedNode([string]$Version) {
  # --use-on-cd는 넣지 않는다. 넣으면 설치 전에 fnm이 저장소의 .nvmrc를 보고 설치 여부를 물어 멈춘다.
  & fnm env --corepack-enabled --shell powershell | Out-String | Invoke-Expression
  $installed = (& fnm list) -join "`n"
  if ($installed -match "v$([regex]::Escape($Version))\b") {
    Write-Host "Node $Version 설치돼 있음"
  } else {
    Invoke-Native 'fnm' @('install', $Version)
  }
  Invoke-Native 'fnm' @('use', $Version)
  if ($installed -notmatch '\bdefault\b') {
    # 저장소 밖에서 연 새 터미널도 같은 Node로 시작하게 한다.
    Invoke-Native 'fnm' @('default', $Version)
  }
  $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
  Invoke-Native 'corepack' @('enable')
  $current = (& node --version).Trim()
  if ($current -ne "v$Version") {
    throw "fnm use 뒤에도 node가 $current 이다(.nvmrc는 $Version). PATH에서 앞서는 다른 Node 설치를 확인한다."
  }
  Write-Host "Node $current 사용"
}

function Write-SystemNodeWarning([string]$Version) {
  if (-not $onWindows) { return }
  # fnm은 터미널 안에서만 PATH를 바꾼다. 탐색기에서 더블클릭한 .bat은 시스템 PATH의 Node를 쓴다.
  foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if (Test-Path -LiteralPath $candidate) {
      $systemVersion = (& $candidate --version).Trim()
      if ($systemVersion -ne "v$Version") {
        Write-Warning "시스템 Node $systemVersion 가 $candidate 에 있다. 터미널에서는 fnm의 v$Version 이 쓰이지만, 탐색기에서 .bat을 더블클릭하면 이 Node가 쓰인다. 쓰지 않으면 '앱 및 기능'에서 Node.js를 제거한다."
      }
    }
  }
}

Set-Location -LiteralPath $repoRoot
$nodeVersion = ([IO.File]::ReadAllText((Join-Path $repoRoot '.nvmrc'))).Trim()

Write-Step '1/5 fnm 설치'
Install-Fnm

Write-Step '2/5 셸 프로필에 fnm 자동 전환 추가'
Set-ProfileExecutionPolicy
Add-ShellProfiles

Write-Step "3/5 Node $nodeVersion (.nvmrc)"
Use-PinnedNode $nodeVersion

Write-Step '4/5 의존성 설치'
Invoke-Native 'pnpm' @('install', '--frozen-lockfile')
if ($SkipBrowsers) {
  Write-Host 'Playwright 브라우저 설치를 건너뜀(-SkipBrowsers)'
} else {
  Invoke-Native 'pnpm' @('--filter', 'e2e', 'exec', 'playwright', 'install', 'chromium')
}

Write-Step '5/5 환경 점검 (pnpm dev:check)'
& pnpm dev:check
$checkExit = $LASTEXITCODE
Write-SystemNodeWarning $nodeVersion

Write-Host ''
if ($checkExit -eq 0) {
  Write-Host '설정 완료. 새 터미널부터는 저장소 폴더에 들어가면 .nvmrc의 Node로 자동 전환된다.' -ForegroundColor Green
} else {
  Write-Host '설정은 끝났지만 dev:check에 [실패] 항목이 있다. 위 안내대로 고친 뒤 pnpm dev:check를 다시 실행한다.' -ForegroundColor Yellow
}
exit $checkExit
