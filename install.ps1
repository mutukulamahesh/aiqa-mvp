# AIQA installer — Windows PowerShell
# Usage: iwr https://raw.githubusercontent.com/mutukulamahesh/aiqa-mvp/main/install.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO       = "https://github.com/mutukulamahesh/aiqa-mvp.git"
$INSTALL_DIR = "$env:USERPROFILE\.aiqa-runner"
$MIN_NODE   = 18

function Print($msg) { Write-Host "[aiqa] $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "[aiqa] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "[aiqa] $msg" -ForegroundColor Yellow }
function Die($msg)   { Write-Host "[aiqa] $msg" -ForegroundColor Red; exit 1 }

# ── Node.js check / install ───────────────────────────────────────────────────

function Test-Node {
  try {
    $ver = (node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>$null)
    return ([int]$ver -ge $MIN_NODE)
  } catch { return $false }
}

if (Test-Node) {
  Ok "Node.js $(node --version) detected"
} else {
  Warn "Node.js $MIN_NODE+ not found — installing via winget"
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    Ok "Node.js installed — you may need to restart your terminal if 'aiqa' is not found"
  } else {
    Die "winget not available. Install Node.js $MIN_NODE+ from https://nodejs.org then re-run this script."
  }
}

# ── Clone / update AIQA ───────────────────────────────────────────────────────

if (Test-Path "$INSTALL_DIR\.git") {
  Print "Updating existing AIQA installation..."
  git -C $INSTALL_DIR pull --ff-only --quiet
} else {
  Print "Installing AIQA to $INSTALL_DIR ..."
  git clone --depth 1 --quiet $REPO $INSTALL_DIR
}

Set-Location $INSTALL_DIR
Print "Installing dependencies..."
npm ci --silent --omit=dev

# ── Install Playwright browsers ───────────────────────────────────────────────

Print "Installing Playwright browsers..."
try {
  npx playwright install chromium --with-deps 2>$null
} catch {
  Warn "Playwright browser install failed — run 'npx playwright install chromium' manually"
}

# ── Link CLI globally ─────────────────────────────────────────────────────────

Print "Linking aiqa CLI..."
npm link --silent

# ── Verify ────────────────────────────────────────────────────────────────────

if (Get-Command aiqa -ErrorAction SilentlyContinue) {
  Ok "AIQA installed successfully!"
  Write-Host ""
  Write-Host "  Run a test:    aiqa run tests\example.yaml"
  Write-Host "  Run all tests: aiqa run-all tests\ --headless"
  Write-Host "  Get help:      aiqa --help"
} else {
  Warn "Restart your terminal then run: aiqa --help"
}
