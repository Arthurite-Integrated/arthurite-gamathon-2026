<#
.SYNOPSIS
  Installs everything the workshop needs on Windows 10/11, then installs the project.

.DESCRIPTION
  Run from the project folder in PowerShell:

      powershell -ExecutionPolicy Bypass -File .\setup\setup-windows.ps1

  Options:
      -Check          only report what is installed, change nothing
      -Yes            do not ask before installing
      -SkipProject    do not run npm install / tests for backend and frontend

  Safe to run again: anything already installed is skipped.
  Installs (with winget): Node.js (22 or newer), Git, AWS CLI v2, Google Chrome,
  then the project's npm packages.
  It cannot sign you in to AWS or install Kiro; it tells you how at the end.
  Windows may show a permission (UAC) prompt for some installers: click Yes.
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Yes,
  [switch]$SkipProject
)

$ErrorActionPreference = 'Continue'
$script:Problems = 0

function Ok($m)      { Write-Host "  [OK]      $m" -ForegroundColor Green }
function Doing($m)   { Write-Host "  [INSTALL] $m" -ForegroundColor Cyan }
function Todo($m)    { Write-Host "  [TODO]    $m" -ForegroundColor Yellow; $script:Problems++ }
function Failed($m)  { Write-Host "  [FAILED]  $m" -ForegroundColor Red;    $script:Problems++ }
function Heading($m) { Write-Host ""; Write-Host $m -ForegroundColor White }

function Has($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }

function Refresh-Path {
  # Pick up tools that were just installed, without opening a new window.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Node-Major {
  if (-not (Has 'node')) { return 0 }
  try { return [int](((& node -v) -replace '^v(\d+)\..*$', '$1')) } catch { return 0 }
}

function Aws-Major {
  if (-not (Has 'aws')) { return 0 }
  try {
    $v = (& aws --version 2>&1) | Out-String
    if ($v -match 'aws-cli/(\d+)\.') { return [int]$Matches[1] }
  } catch { }
  return 0
}

function Winget-Install($id, $label) {
  Doing "$label (winget: $id)"
  & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  # -1978335189 means "already installed / no newer version", which is fine.
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
    Failed "winget could not install $label (exit code $LASTEXITCODE)"
    return $false
  }
  Refresh-Path
  return $true
}

function Confirm-Install($question) {
  if ($Yes) { return $true }
  $answer = Read-Host "  $question [y/N]"
  return ($answer -match '^(y|yes)$')
}

$Root = Split-Path -Parent $PSScriptRoot

Heading "Checking your computer (Windows)"

if ($Root -match 'OneDrive') {
  Todo "This project is inside OneDrive. Installs can be very slow or fail there. Move the folder to C:\dev\ if you have problems."
}

# --- winget ---------------------------------------------------------------
$haveWinget = Has 'winget'
if ($haveWinget) {
  Ok "winget (Windows package manager)"
} else {
  Todo "winget is missing. Open the Microsoft Store, update 'App Installer', then run this script again."
}

function Ensure-Tool($name, $isOk, $id, $label, $okText) {
  if (& $isOk) { Ok (& $okText); return }
  if ($Check) { Todo "$label is missing"; return }
  if (-not $haveWinget) { Failed "Cannot install $label without winget"; return }
  [void](Winget-Install $id $label)
  if (& $isOk) { Ok "$label installed" } else { Failed "$label is still not available. Close this window, open a new one, and run the script again." }
}

# --- Git ------------------------------------------------------------------
Ensure-Tool 'git' { Has 'git' } 'Git.Git' 'Git' { "Git $((& git --version) -replace 'git version ','')" }

# --- Node.js 22+ ----------------------------------------------------------
if ((Node-Major) -ge 22) {
  Ok "Node.js $(& node -v) and npm $(& npm.cmd -v)"
} else {
  if (Has 'node') { Todo "Node.js $(& node -v) is too old; version 22 or newer is needed" } else { Todo "Node.js is not installed" }
  if (-not $Check) {
    if ($haveWinget) {
      [void](Winget-Install 'OpenJS.NodeJS.LTS' 'Node.js (LTS)')
      if ((Node-Major) -lt 22) {
        # The LTS package can lag behind on some machines; ask for the explicit v22 package.
        [void](Winget-Install 'OpenJS.NodeJS.22' 'Node.js 22')
      }
    }
    if ((Node-Major) -ge 22) { Ok "Node.js $(& node -v) installed" }
    else { Failed "Node.js 22 or newer is still not available. Install it from https://nodejs.org, then run this script again." }
  }
}

# --- AWS CLI v2 -----------------------------------------------------------
if ((Aws-Major) -ge 2) {
  Ok "AWS CLI $((& aws --version 2>&1 | Out-String).Trim().Split(' ')[0])"
} else {
  if (Has 'aws') { Todo "AWS CLI is version 1; version 2 is needed" } else { Todo "AWS CLI is not installed" }
  if (-not $Check) {
    if ($haveWinget) { [void](Winget-Install 'Amazon.AWSCLI' 'AWS CLI v2') }
    if ((Aws-Major) -ge 2) { Ok "AWS CLI installed" } else { Failed "AWS CLI v2 is still not available. Close this window, open a new one, and run the script again." }
  }
}

# --- Chrome ---------------------------------------------------------------
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
)
$chromeFound = $false
foreach ($p in $chromePaths) { if ($p -and (Test-Path $p)) { $chromeFound = $true } }
if ($chromeFound) {
  Ok "Google Chrome"
} elseif ($Check) {
  Todo "Google Chrome is missing (needed to test games with Kiro)"
} elseif ($haveWinget) {
  [void](Winget-Install 'Google.Chrome' 'Google Chrome')
} else {
  Todo "Install Chrome from https://www.google.com/chrome"
}

# --- Kiro -----------------------------------------------------------------
$kiroPaths = @("$env:LocalAppData\Programs\Kiro\Kiro.exe", "$env:ProgramFiles\Kiro\Kiro.exe")
$kiroFound = (Has 'kiro')
foreach ($p in $kiroPaths) { if (Test-Path $p) { $kiroFound = $true } }
if ($kiroFound) { Ok "Kiro" } else { Todo "Kiro is not installed. Download it from https://kiro.dev and sign in" }

# --- AWS sign-in status ---------------------------------------------------
if (Has 'aws') {
  $account = (& aws sts get-caller-identity --query Account --output text 2>$null)
  if ($LASTEXITCODE -eq 0 -and $account) {
    Ok "AWS sign-in works ($account)"
  } else {
    Todo "Not signed in to AWS yet. Run: aws configure sso   (company account)   or: aws configure   (access keys)"
  }
}

# --- Project packages and self-test --------------------------------------
if (-not $Check -and -not $SkipProject) {
  Heading "Installing the project"
  if ((Node-Major) -lt 22) {
    Todo "Skipping project install because Node.js 22 is not available yet. Open a new PowerShell window and run this script again."
  } elseif (-not ((Test-Path (Join-Path $Root 'backend\package.json')) -and (Test-Path (Join-Path $Root 'frontend\package.json')))) {
    Todo "Could not find backend and frontend folders next to this script ($Root). Run it from inside the project folder."
  } else {
    foreach ($part in 'backend', 'frontend') {
      $dir = Join-Path $Root $part
      $cmd = if (Test-Path (Join-Path $dir 'package-lock.json')) { 'ci' } else { 'install' }
      Doing "$part packages (this takes a minute)"
      Push-Location $dir
      # npm.cmd, not npm: PowerShell may block npm.ps1 when script execution is restricted.
      & npm.cmd $cmd --no-audit --no-fund --loglevel=error
      $code = $LASTEXITCODE
      Pop-Location
      if ($code -eq 0) { Ok "$part packages installed" } else { Failed "npm $cmd failed in $part" }
    }
    foreach ($part in 'backend', 'frontend') {
      Push-Location (Join-Path $Root $part)
      & npm.cmd test --silent *> $null
      $code = $LASTEXITCODE
      Pop-Location
      if ($code -eq 0) { Ok "$part tests pass" } else { Failed "$part tests failed. Run: cd $part; npm.cmd test" }
    }
  }
}

# --- Summary --------------------------------------------------------------
Heading "Summary"
if ($script:Problems -eq 0) {
  Write-Host "  Everything is ready." -ForegroundColor Green
} else {
  Write-Host "  $($script:Problems) item(s) need attention (marked [TODO] or [FAILED] above)." -ForegroundColor Yellow
}

Write-Host @"

Next steps
  1. Close this window and open a NEW PowerShell window (so new tools are on your PATH).
  2. Try the game locally, no AWS needed:
       Window 1:  cd backend; npm run local:realtime
       Window 2:  cd frontend; npm run dev:local
     Then open http://localhost:5173/?as=alice and http://localhost:5173/?as=bob
  3. To deploy: sign in to AWS (aws configure sso), then
       cd backend; npx cdk bootstrap
  4. Open this folder in Kiro (File > Open Folder).

If PowerShell says "running scripts is disabled" for npm, use npm.cmd (for example: npm.cmd run dev:local).
"@

if ($script:Problems -eq 0) { exit 0 } else { exit 1 }
